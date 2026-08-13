type FGLogoProps = {
  size?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
};

/** Shared brand mark. Kept as an SVG so it remains sharp in the canvas UI. */
export default function FGLogo({ size = 36, className, title = "FG Studio", style }: FGLogoProps) {
  return <img src="/fg-logo.svg" width={size} height={size} alt={title} className={className} style={{ display: "block", flex: "none", objectFit: "contain", ...style }} />;
}
