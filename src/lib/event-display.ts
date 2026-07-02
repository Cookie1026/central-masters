const EVENT_TYPES = ['自由形', '平泳ぎ', 'バタフライ', '背泳ぎ', '個人メドレー', 'フリーリレー', 'メドレーリレー'] as const

export function formatEventDisplay(name: string): string {
  const type = EVENT_TYPES.find((candidate) => name.includes(candidate))
  const relayDistance = name.match(/(\d+)×(\d+)m/)
  const singleDistance = name.match(/(\d+)m/)
  const distance = relayDistance
    ? `${relayDistance[1]}×${relayDistance[2]}m`
    : singleDistance
      ? `${singleDistance[1]}m`
      : ''
  const detail = name.includes('／') ? `／${name.split('／').slice(1).join('／')}` : ''
  return type && distance ? `${type} ${distance}${detail}` : name
}
