import resourceDefinitionsData from "./resourceDefinitions.json";

export type ResourceDefinition =
  | {
      kind: "uri";
      name: string;
      description: string;
      mimeType: string;
      uri: string;
    }
  | {
      kind: "template";
      name: string;
      description: string;
      mimeType: string;
      template: string;
      variables?: readonly string[];
    };

const resourceDefinitions = resourceDefinitionsData as ResourceDefinition[];

export default resourceDefinitions;
