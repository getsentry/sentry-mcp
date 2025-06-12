import { UserInputError } from "../errors"

export interface ErrorContext {
  operation: string
  projectPath?: string
  framework?: string
  language?: string
  userInput?: Record<string, any>
  systemDetails?: Record<string, any>
}

export interface ValidationError {
  field: string
  message: string
  value?: any
  suggestion?: string
}

export class ProjectDetectionError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = "ProjectDetectionError"
  }
}

export class SdkContextError extends Error {
  constructor(
    message: string,
    public readonly framework: string,
    public readonly url?: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = "SdkContextError"
  }
}

export class InstrumentationError extends Error {
  constructor(
    message: string,
    public readonly language: string,
    public readonly framework?: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = "InstrumentationError"
  }
}

export function handleProjectDetectionError(
  error: unknown,
  context: ErrorContext,
): never {
  if (error instanceof ProjectDetectionError) {
    throw new UserInputError(
      `Failed to detect project type in "${error.path}". ${error.message}`,
    )
  }
  
  if (error instanceof Error) {
    throw new UserInputError(
      `Project detection failed: ${error.message}. Please ensure the directory contains a valid project.`,
    )
  }
  
  throw new UserInputError(
    "Unable to detect project type in the specified directory.",
  )
}

export function handleSdkContextError(
  error: unknown,
  context: ErrorContext,
): never {
  if (error instanceof SdkContextError) {
    throw new UserInputError(
      `Failed to fetch SDK context for ${error.framework}: ${error.message}`,
    )
  }
  
  if (error instanceof Error) {
    throw new UserInputError(
      `SDK context fetch failed: ${error.message}. Please check your network connection and try again.`,
    )
  }
  
  throw new UserInputError(
    "Unable to fetch SDK context. Please try again later.",
  )
}

export function handleInstrumentationError(
  error: unknown,
  context: ErrorContext,
): never {
  if (error instanceof InstrumentationError) {
    throw new UserInputError(
      `Instrumentation failed for ${error.language}${error.framework ? ` (${error.framework})` : ""}: ${error.message}`,
    )
  }
  
  if (error instanceof Error) {
    throw new UserInputError(
      `Instrumentation generation failed: ${error.message}. Please verify your project configuration.`,
    )
  }
  
  throw new UserInputError(
    "Unable to generate instrumentation plan. Please check your project settings.",
  )
}

export function handleValidationErrors(
  errors: ValidationError[],
  context: ErrorContext,
): never {
  const formattedErrors = errors
    .map(error => `${error.field}: ${error.message}${error.suggestion ? ` (${error.suggestion})` : ""}`)
    .join("; ")
  
  throw new UserInputError(
    `Validation failed for ${context.operation}: ${formattedErrors}`,
  )
} 
