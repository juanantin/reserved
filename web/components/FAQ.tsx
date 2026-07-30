"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { faq } from "@/config/site";
import { FadeIn } from "./FadeIn";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-white/10 bg-rsvd-navy px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">FAQ</h2>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-8 divide-y divide-white/10 rounded-lg border border-white/10">
          {faq.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={item.question}>
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left focus-gold"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium">{item.question}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-rsvd-gold transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && <p className="px-6 pb-4 text-sm text-rsvd-offwhite/70">{item.answer}</p>}
              </div>
            );
          })}
        </FadeIn>
      </div>
    </section>
  );
}
