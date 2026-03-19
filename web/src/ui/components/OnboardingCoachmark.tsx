import React, { useEffect, useState } from 'react';

type Props = {
  testId: string;
  targetSelector: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
};

type AnchorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function OnboardingCoachmark({
  testId,
  targetSelector,
  title,
  body,
  placement = 'bottom',
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary
}: Props) {
  const [targetRect, setTargetRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      const target = document.querySelector(targetSelector) as HTMLElement | null;
      if (!target) {
        setTargetRect(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    const timerId = window.setInterval(updateRect, 300);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      window.clearInterval(timerId);
    };
  }, [targetSelector]);

  if (!targetRect) return null;

  const cardWidth = Math.min(320, window.innerWidth - 24);
  const gap = 12;
  let top = targetRect.top + targetRect.height + gap;
  let left = targetRect.left + targetRect.width / 2 - cardWidth / 2;

  if (placement === 'top') {
    top = targetRect.top - gap - 132;
  } else if (placement === 'left') {
    top = targetRect.top + targetRect.height / 2 - 66;
    left = targetRect.left - cardWidth - gap;
  } else if (placement === 'right') {
    top = targetRect.top + targetRect.height / 2 - 66;
    left = targetRect.left + targetRect.width + gap;
  }

  const safeTop = clamp(top, 12, Math.max(12, window.innerHeight - 170));
  const safeLeft = clamp(left, 12, Math.max(12, window.innerWidth - cardWidth - 12));

  return (
    <div
      className="onboarding-coachmark"
      data-testid={testId}
      style={{
        top: `${safeTop}px`,
        left: `${safeLeft}px`,
        width: `${cardWidth}px`
      }}
      role="dialog"
      aria-live="polite"
    >
      <div className="onboarding-coachmark-kicker">Quick start</div>
      <div className="onboarding-coachmark-title">{title}</div>
      <p className="onboarding-coachmark-body">{body}</p>
      <div className="onboarding-coachmark-actions">
        {secondaryLabel ? (
          <button type="button" className="button secondary" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
        {primaryLabel ? (
          <button type="button" className="button" onClick={onPrimary}>
            {primaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
