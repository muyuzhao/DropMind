import { CaptureForm } from "@/components/inbox/capture-form";

export default function CapturePage() {
  return (
    <section className="page narrow">
      <div className="eyebrow">QUICK CAPTURE</div>
      <h1>脑海里的东西，<br />先放在这里。</h1>
      <p className="lede">原文会先被可靠保存。整理可以稍后发生，灵感不必等。</p>
      <CaptureForm />
    </section>
  );
}
