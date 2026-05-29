// Shim: next/image → regular img tag
import { forwardRef } from "react";

const Image = forwardRef(function Image({ src, alt, width, height, className, fill, ...props }, ref) {
  const style = fill ? { objectFit: "cover", width: "100%", height: "100%" } : {};
  return (
    <img
      ref={ref}
      src={src}
      alt={alt || ""}
      width={width}
      height={height}
      className={className}
      style={style}
      {...props}
    />
  );
});

Image.displayName = "Image";
export default Image;
