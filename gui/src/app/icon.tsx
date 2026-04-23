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
          borderRadius: 9,
          background: "linear-gradient(135deg, #7c3aed 0%, #4338ca 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          {/* Double chevron */}
          <path
            d="M4 7.5L8 11L4 14.5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 7.5L14 11L10 14.5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Trailing dot */}
          <circle cx="18" cy="11" r="1.8" fill="rgba(255,255,255,0.5)" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
