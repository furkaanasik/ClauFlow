import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#efece3",
          color: "#0a0908",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: "-0.05em",
          position: "relative",
        }}
      >
        cf
        <span
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 3,
            bottom: 0,
            background: "#d4ff3d",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
