"use client";

import { useLayoutEffect } from "react";

const REVEAL_SELECTOR = "[data-motion-reveal]";

export function MotionObserver() {
  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const observedElements = new WeakSet<Element>();

    if (reducedMotion) {
      document.querySelectorAll(REVEAL_SELECTOR).forEach((element) => {
        element.classList.add("motion-visible");
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("motion-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -7% 0px",
        threshold: 0.08,
      },
    );

    const observe = (root: ParentNode) => {
      root.querySelectorAll(REVEAL_SELECTOR).forEach((element) => {
        if (observedElements.has(element)) return;
        observedElements.add(element);
        element.classList.add("motion-pending");
        observer.observe(element);
      });
    };

    observe(document);

    const mutations = new MutationObserver((entries) => {
      entries.forEach((entry) => {
        entry.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(REVEAL_SELECTOR)) {
            if (!observedElements.has(node)) {
              observedElements.add(node);
              node.classList.add("motion-pending");
              observer.observe(node);
            }
          }
          observe(node);
        });
      });
    });

    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}
