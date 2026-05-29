// Shim: next/link → react-router-dom Link
import { Link as RouterLink } from "react-router-dom";
import { forwardRef } from "react";

const Link = forwardRef(function Link({ href, children, className, ...props }, ref) {
  return (
    <RouterLink to={href || "/"} className={className} ref={ref} {...props}>
      {children}
    </RouterLink>
  );
});

Link.displayName = "Link";
export default Link;
