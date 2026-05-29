// Shim: next/navigation → react-router-dom hooks
import { useNavigate, useLocation, useSearchParams as useRRSearchParams, useParams } from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (url) => navigate(url),
    replace: (url) => navigate(url, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => {},
  };
}

export function usePathname() {
  const location = useLocation();
  return location.pathname;
}

export function useSearchParams() {
  const [searchParams] = useRRSearchParams();
  return searchParams;
}

export { useParams };

export function notFound() {
  return null;
}
