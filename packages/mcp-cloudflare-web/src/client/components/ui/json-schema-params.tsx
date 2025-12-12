type JsonSchema =
  | {
      properties?: Record<string, { description?: string } | undefined>;
      required?: string[];
    }
  | null
  | undefined;

interface JsonSchemaParamsProps {
  schema: unknown;
  title?: string;
}

/**
 * Renders a standardized Parameters box from a JSON Schema-like object.
 * - Expects an object with a `properties` map; falls back to a flat key->description map.
 * - Returns null when there are no parameters to display.
 */
export default function JsonSchemaParams({
  schema,
  title = "Parameters",
}: JsonSchemaParamsProps) {
  let entries: Array<[string, { description?: string } | undefined]> = [];

  const obj = (schema as JsonSchema) ?? undefined;
  if (obj && typeof obj === "object" && "properties" in obj) {
    const props = obj.properties;
    if (props && Object.keys(props).length > 0) {
      entries = Object.entries(props);
    }
  } else if (schema && typeof schema === "object") {
    const flat = schema as Record<string, { description?: string } | undefined>;
    const keys = Object.keys(flat);
    if (keys.length > 0) {
      entries = Object.entries(flat);
    }
  }

  if (entries.length === 0) return null;

  return (
    <section className="rounded-md border border-slate-700/60 bg-black/30 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-300/80 mb-1">
        {title}
      </div>
      <dl className="space-y-0">
        {entries.map(([key, property]) => (
          <div key={key} className="p-2 bg-black/20">
            <dt className="text-sm font-medium text-violet-300">{key}</dt>
            <dd className="text-sm text-slate-300 mt-0.5">
              {property?.description || ""}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
