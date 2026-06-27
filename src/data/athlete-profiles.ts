export interface AthleteProfile {
  image: string
  animal: string
  catchphrase: string
}

const OOTAKA_DEFAULT_PROFILE: AthleteProfile = {
  image: '/profiles/ootaka-otter.webp',
  animal: 'カワウソ',
  catchphrase: '水の中では、だいたいごきげん。',
}

const ATHLETE_PROFILES: Record<number, AthleteProfile> = {}

export function getAthleteProfile(
  athleteId: number,
  teamName: string,
): AthleteProfile | null {
  if (!teamName.includes('おおたか')) return null
  return ATHLETE_PROFILES[athleteId] ?? OOTAKA_DEFAULT_PROFILE
}
