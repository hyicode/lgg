import { useEffect, useState } from "react";

/**
 * Loads the temporary DOM controller after React has committed the complete UI.
 * New business logic belongs in src/domain and can be consumed by React directly;
 * this adapter can then shrink feature by feature without changing the bootstrap.
 */
export function useLegacyController(): Error | null {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    void import("../../assets/js/app.js").catch((reason: unknown) => {
      if (!mounted) return;
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    });

    return () => {
      mounted = false;
    };
  }, []);

  return error;
}
