const ENTER_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Shared motion rules for the dashboard shell.
 * Respect reduced motion by removing travel/press transforms and keeping
 * only brief opacity changes where a state transition still needs feedback.
 */
export function getSurfaceEnterMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.12, ease: 'linear' as const },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.18, ease: ENTER_EASE },
      };
}

export function getViewTransitionMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.14, ease: 'linear' as const },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { duration: 0.2, ease: ENTER_EASE },
      };
}

export function getProminentInteractiveMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {}
    : {
        whileTap: { scale: 0.985 },
        transition: { duration: 0.14, ease: ENTER_EASE },
      };
}

export function getOperationalInteractiveMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {}
    : {
        whileTap: { scale: 0.992 },
        transition: { duration: 0.12, ease: ENTER_EASE },
      };
}

export function getContentSwapMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.1, ease: 'linear' as const },
      }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.16, ease: ENTER_EASE },
      };
}
