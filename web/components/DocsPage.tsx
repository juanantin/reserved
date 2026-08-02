import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { docsContent } from "@/lib/docsContent";
import { dictionaries, type Locale } from "@/lib/i18n";

export function DocsPage({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].docsPage;
  const sections = docsContent[locale];
  const homeHref = locale === "zh" ? "/zh" : "/";

  return (
    <>
      <Navbar locale={locale} langHrefOverride={locale === "zh" ? "/docs" : "/zh/docs"} />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <a href={homeHref} className="text-sm text-rsvd-gold/80 transition-colors hover:text-rsvd-gold focus-gold">
          {t.backToSite}
        </a>
        <h1 className="mt-4 text-3xl font-bold md:text-4xl">{t.title}</h1>
        <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">{t.subtitle}</p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav aria-label={t.onThisPage} className="hidden lg:block">
            <div className="sticky top-24">
              <div className="text-xs font-semibold uppercase tracking-widest text-rsvd-offwhite/40">{t.onThisPage}</div>
              <ul className="mt-4 space-y-3 border-l border-white/10 pl-4 text-sm">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-rsvd-offwhite/60 transition-colors hover:text-rsvd-gold focus-gold">
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="min-w-0 space-y-16">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-24">
                <h2 className="text-xl font-bold text-rsvd-gold md:text-2xl">{section.title}</h2>
                <div className="mt-4 space-y-4">
                  {section.blocks.map((block, i) =>
                    block.type === "p" ? (
                      <p key={i} className="leading-relaxed text-rsvd-offwhite/80">
                        {block.text}
                      </p>
                    ) : (
                      <ul key={i} className="list-disc space-y-2 pl-5 leading-relaxed text-rsvd-offwhite/80">
                        {block.items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
