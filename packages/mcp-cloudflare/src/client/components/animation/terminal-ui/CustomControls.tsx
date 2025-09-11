export default function CustomControls({
  speed,
  onChangeSpeedAction,
}: {
  speed: number;
  onChangeSpeedAction: (speed: number) => void;
}) {
  return (
    <div className="pointer-events-auto absolute right-5 bottom-5 flex w-fit items-center gap-3 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
      {/* TODO: ⟲ restart button */}

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="#speed" className="text-xs opacity-80">
          Speed
        </label>
        <select
          id="speed"
          className="rounded-lg bg-white/10 px-2 py-1 text-sm hover:bg-white/20"
          onChange={(e) =>
            onChangeSpeedAction(Number.parseFloat(e.target.value))
          }
          value={speed}
        >
          {[0.5, 1, 2, 3, 5, 12, 24].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
