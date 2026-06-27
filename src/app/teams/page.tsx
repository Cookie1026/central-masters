import { redirect } from 'next/navigation'

export default function LegacyTeamsPage() {
  redirect('/?tab=team')
}
