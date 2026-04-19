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
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: ENTER_EASE },
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
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -10 },
        transition: { duration: 0.24, ease: ENTER_EASE },
      };
}

export function getInteractiveMotion(reducedMotion: boolean) {
  return reducedMotion
    ? {}
    : {
        whileHover: { y: -2 },
        whileTap: { scale: 0.995 },
        transition: { duration: 0.16, ease: ENTER_EASE },
      };
}
