import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Styleguide, type StyleguideMode } from "./Styleguide";

export const metadata: Metadata = {
  title: "Styleguide · ClauFlow",
  robots: { index: false, follow: false },
};

/** Developer tool: every Atölye primitive in both themes. Not linked from the app; 404 in production builds. */
export default async function StyleguidePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { mode } = await searchParams;
  const initial: StyleguideMode = mode === "cream" || mode === "night" ? mode : "split";
  return <Styleguide initialMode={initial} />;
}
