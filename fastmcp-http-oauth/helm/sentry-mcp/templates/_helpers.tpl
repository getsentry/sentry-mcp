{{/*
Expand the name of the chart.
*/}}
{{- define "sentry-mcp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "sentry-mcp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "sentry-mcp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "sentry-mcp.labels" -}}
helm.sh/chart: {{ include "sentry-mcp.chart" . }}
{{ include "sentry-mcp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "sentry-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sentry-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "sentry-mcp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sentry-mcp.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the name of the ConfigMap to use
*/}}
{{- define "sentry-mcp.configMapName" -}}
{{- if .Values.existingConfigMap }}
{{- .Values.existingConfigMap }}
{{- else }}
{{- include "sentry-mcp.fullname" . }}
{{- end }}
{{- end }}

{{/*
Get the name of the Secret to use
*/}}
{{- define "sentry-mcp.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "sentry-mcp.fullname" . }}
{{- end }}
{{- end }}

{{/*
Get the Redis URL with optional authentication
*/}}
{{- define "sentry-mcp.redisUrl" -}}
{{- if or .Values.redis.password .Values.redis.existingSecret }}
{{- $redisUrl := .Values.config.redisUrl }}
{{- /* Parse the URL and inject password - simplified approach */ -}}
{{- $redisUrl }}
{{- else }}
{{- .Values.config.redisUrl }}
{{- end }}
{{- end }}
