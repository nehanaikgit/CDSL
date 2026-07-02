import logoImg from "../assets/gepl-logo.jpg";

export default function Logo({ height = 36 }) {
  return (
    <img
      src={logoImg}
      alt="GEPL"
      style={{
        height: `${height}px`,
        width: "auto",
        display: "block",
        borderRadius: "4px",
      }}
    />
  );
}