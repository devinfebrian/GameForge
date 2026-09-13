/**
 * A process-wide double for the data access layer.
 *
 * Same reasoning as the service-role and server-env doubles: Bun binds a mocked
 * module path once per process, so every test that needs `@/lib/dal` must
 * install the same factory and configure it through this shared state. Two
 * independent `mock.module("@/lib/dal", ...)` factories would otherwise make the
 * suite order-dependent — and the loser would be missing a function entirely.
 *
 * Only test files import this module; it is never part of the application graph.
 */

export interface DalDoubleProfile {
  readonly id: string;
  readonly role: "user" | "admin";
  readonly email: string;
  readonly avatarUrl: string | null;
}

export const dalDouble = {
  profile: null as DalDoubleProfile | null,

  reset(profile: DalDoubleProfile | null = null): void {
    this.profile = profile;
  },

  getCurrentProfile(): DalDoubleProfile | null {
    return dalDouble.profile;
  },

  /**
   * The real `requireUser` redirects and `requireAdmin` 404s, which only mean
   * something inside a Next request. Throwing here keeps a test that forgot to
   * sign someone in from silently passing.
   */
  requireUser(): DalDoubleProfile {
    if (dalDouble.profile === null) {
      throw new Error("[dal.double] requireUser called with no signed-in profile");
    }

    return dalDouble.profile;
  },

  requireAdmin(): DalDoubleProfile {
    const profile = dalDouble.requireUser();

    if (profile.role !== "admin") {
      throw new Error("[dal.double] requireAdmin called for a non-admin");
    }

    return profile;
  },
};

export function createDalDouble(): {
  getCurrentProfile: () => DalDoubleProfile | null;
  requireUser: () => DalDoubleProfile;
  requireAdmin: () => DalDoubleProfile;
} {
  return {
    getCurrentProfile: () => dalDouble.getCurrentProfile(),
    requireUser: () => dalDouble.requireUser(),
    requireAdmin: () => dalDouble.requireAdmin(),
  };
}
