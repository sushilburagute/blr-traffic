'use client';
import { Sheet } from '@/components/ui/sheet';
import { useUiStore } from '@/store/uiStore';
import { guideSections } from '@/content/guide';
export function HelpSheet() {
  const open = useUiStore((s) => s.help);
  return (
    <Sheet
      open={open}
      onOpenChange={(help) => useUiStore.setState({ help })}
      title="Your field guide"
    >
      <nav className="help-contents">
        {guideSections.map((s) => (
          <a key={s.id} href={`#help-${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      {guideSections.map((s) => (
        <section className="help-section" id={`help-${s.id}`} key={s.id}>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </section>
      ))}
    </Sheet>
  );
}
