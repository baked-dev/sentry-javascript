import { captureException, getCurrentHub, startTransaction } from '@sentry/core';
import { baggageHeaderToDynamicSamplingContext, extractTraceparentData } from '@sentry/utils';
import * as domain from 'domain';

import type { ServerComponentContext } from '../common/types';

/**
 * Wraps an `app` directory server component with Sentry error instrumentation.
 */
export function wrapServerComponentWithSentry<F extends (...args: any[]) => any>(
  appDirComponent: F,
  context: ServerComponentContext,
): F {
  const { componentRoute, componentType } = context;

  // Even though users may define server components as async functions, for the client bundles
  // Next.js will turn them into synchronous functions and it will transform any `await`s into instances of the `use`
  // hook. 🤯
  return new Proxy(appDirComponent, {
    apply: (originalFunction, thisArg, args) => {
      return domain.create().bind(() => {
        let maybePromiseResult;

        const traceparentData = context.sentryTraceHeader
          ? extractTraceparentData(context.sentryTraceHeader)
          : undefined;

        const dynamicSamplingContext = baggageHeaderToDynamicSamplingContext(context.baggageHeader);

        const transaction = startTransaction({
          op: 'function.nextjs',
          name: `${componentType} Server Component (${componentRoute})`,
          status: 'ok',
          ...traceparentData,
          metadata: {
            source: 'component',
            dynamicSamplingContext: traceparentData && !dynamicSamplingContext ? {} : dynamicSamplingContext,
          },
        });

        const currentScope = getCurrentHub().getScope();
        if (currentScope) {
          currentScope.setSpan(transaction);
        }

        try {
          maybePromiseResult = originalFunction.apply(thisArg, args);
        } catch (e) {
          transaction.setStatus('internal_error');
          captureException(e);
          transaction.finish();
          throw e;
        }

        if (typeof maybePromiseResult === 'object' && maybePromiseResult !== null && 'then' in maybePromiseResult) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          Promise.resolve(maybePromiseResult).then(
            () => {
              transaction.finish();
            },
            (e: Error) => {
              transaction.setStatus('internal_error');
              captureException(e);
              transaction.finish();
            },
          );

          // It is very important that we return the original promise here, because Next.js attaches various properties
          // to that promise and will throw if they are not on the returned value.
          return maybePromiseResult;
        } else {
          transaction.finish();
          return maybePromiseResult;
        }
      })();
    },
  });
}
