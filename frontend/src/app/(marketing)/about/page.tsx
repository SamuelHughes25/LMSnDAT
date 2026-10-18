export const metadata = {
  title: "About Us — LMS",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">About us</h1>

      <div className="mt-6 space-y-5 text-muted-foreground">
        <p>
          Right now, &quot;us&quot; is one person. This platform is a one-man-band project — built,
          designed, and maintained by a single developer who got tired of seeing enterprise learning
          software that&apos;s either far more complicated than it needs to be, or barely functional
          at all.
        </p>
        <p>
          The goal is simple: build a learning management system that&apos;s genuinely easy to use —
          for the people building the courses and the people taking them — without cutting corners on
          the parts that actually matter, like proper scoring, clear records, and content that stays
          organised as it grows.
        </p>
        <p>
          It&apos;s still early. There&apos;s no long client list here yet, no case studies, no logos
          to show off — just a platform being built properly, one feature at a time, before it&apos;s
          put in front of real organisations. This page will grow once that starts happening.
        </p>
      </div>
    </div>
  );
}
