import { supabase } from '@/lib/supabase'

export default async function Home() {
  const { data: ageGroups, error } = await supabase
    .from('age_groups')
    .select('*')
    .order('min_age')

  if (error) {
    return <p style={{ color: 'red' }}>接続エラー: {error.message}</p>
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Supabase接続テスト</h1>
      <p>age_groupsテーブル: {ageGroups?.length}件取得</p>
      <ul>
        {ageGroups?.map((g) => (
          <li key={g.id}>{g.name}</li>
        ))}
      </ul>
    </main>
  )
}
