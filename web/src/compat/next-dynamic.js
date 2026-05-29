// Shim: next/dynamic → React.lazy
import { lazy, Suspense } from "react";

export default function dynamic(importFn, options = {}) {
  const LazyComponent = lazy(importFn);
  const { ssr = true, loading: LoadingComponent } = options;

  return function DynamicComponent(props) {
    const fallback = LoadingComponent ? <LoadingComponent /> : null;
    return (
      <Suspense fallback={fallback}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
