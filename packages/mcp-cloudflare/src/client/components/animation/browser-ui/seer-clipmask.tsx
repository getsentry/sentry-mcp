export default function SeerClipMask({ id }: { id: string }) {
  return (
    <svg className="absolute" height="0" width="0">
      <title>Seer's Triangle</title>
      <defs>
        <clipPath clipPathUnits="objectBoundingBox" id={id}>
          <path d="M0.5 0 A2.5 2.5 0 0 1 1 0.866025 A2.5 2.5 0 0 1 0 0.866025 A2.5 2.5 0 0 1 0.5 0 Z" />
        </clipPath>
      </defs>
    </svg>
  );
}
