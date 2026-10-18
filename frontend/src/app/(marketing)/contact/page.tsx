import { Mail } from "lucide-react";

export const metadata = {
  title: "Contact Us — LMS",
};

// Deliberately a placeholder, not a working contact form — no backend
// endpoint to receive it, and no public email address wired in on purpose
// (that's a separate decision for whenever this is actually ready to take
// real enquiries). Replace this whole page once there's somewhere for a
// submission to actually go.
export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <Mail className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="mt-4 text-muted-foreground">
        This page isn&apos;t wired up yet — check back soon for a proper way to get in touch.
      </p>
    </div>
  );
}
