import Logger, { LogLevel } from 'bunyan'
import PrettyStream from 'bunyan-prettystream'
import {
  HttpRequest,
  middleware as commonMiddleware,
} from '@google-cloud/logging'
import {
  LoggingBunyan,
  LOGGING_SAMPLED_KEY,
  LOGGING_SPAN_KEY,
  LOGGING_TRACE_KEY,
} from '@google-cloud/logging-bunyan'
import { ServerResponse } from 'http'
import { ServerRequest } from '@google-cloud/logging/build/src/utils/http-request'
import fastRedact from 'fast-redact'
import type { RedactOptions } from 'fast-redact'

// GAE_SERVICE is the service name of the App Engine service:
//   https://cloud.google.com/appengine/docs/standard/nodejs/runtime#environment_variables
// We also use it to infer we're running in an App Engine environment.
// K_SERVICE name of function resource on a Cloud Function:
//   https://cloud.google.com/functions/docs/configuring/env-var#newer_runtimes
// We also use it to infer we're running in a Cloud Function environment.
function getGoogleServiceName() {
  return process.env.GAE_SERVICE || process.env.K_SERVICE
}

interface ExtendedRedactOptions extends RedactOptions {
  // Allows to globally replace sensitive patterns
  // WARNING: the value is JSON.stringified before being passed to this function
  // and will be JSON.parse'd after
  globalReplace?: (value: string) => string
}

export function createLogger({
  level,
  redact: redactConfig,
}: {
  level?: LogLevel
  redact?: ExtendedRedactOptions
} = {}) {
  const logLevel = level || (process.env.LOG_LEVEL as LogLevel) || 'info'
  const streams: Logger.Stream[] = []
  let name = 'default'

  const googleServiceName = getGoogleServiceName()

  if (googleServiceName) {
    // https://github.com/googleapis/nodejs-logging-bunyan/issues/304
    // https://github.com/googleapis/nodejs-logging-bunyan#alternative-way-to-ingest-logs-in-google-cloud-managed-environments
    // redirectToStdout helps ensure the logging stream is flushed before the process exists.
    // useMessageField must be `false` for Logs Explorer to show the string message as a log entry line
    // Otherwise it nests everything under `jsonPayload.message` and all lines in Logs Explorer look like JSON noise.
    const loggingBunyan = new LoggingBunyan({
      redirectToStdout: true,
      useMessageField: false,
    })
    name = googleServiceName
    streams.push(loggingBunyan.stream(logLevel))
  } else {
    const consoleStream = new PrettyStream({ mode: 'short' })
    consoleStream.pipe(process.stdout)
    streams.push({ stream: consoleStream, level: logLevel })
  }

  const logger = Logger.createLogger({
    name,
    streams,
    serializers: createDetailedRequestSerializers(),
  })

  const redact = fastRedact({ ...redactConfig, serialize: false })

  // Patch _emit to redact sensitive data
  // This redacts **all** fields in the log record, not just the ones we specify in the serializers
  // @ts-expect-error
  logger._emit = new Proxy(logger._emit, {
    apply: function (target, thisArgument, argumentsList) {
      const [logRecord] = argumentsList

      const globalReplace =
        redactConfig?.globalReplace ?? ((value: string) => value)

      // Preserve bunyan's core fields (except for msg)
      // See https://github.com/trentm/node-bunyan#core-fields
      const { v, level, name, hostname, pid, time, src, ...rest } = logRecord

      // redact mutates the input object,
      // so here we copy it and overwrite the log record with the redacted copied version
      // This makes the redact action stable when calling `logger.info({ req })` multiple times
      // i.e. the original `req` object is not mutated
      // This assumes all fields are serializable, which they should at this point
      // BigInt values are transformed to strings during serialization
      Object.assign(
        logRecord,
        redact(JSON.parse(globalReplace(JSON.stringify(rest, bigIntReplacer)))),
      )

      // Call the original _emit
      return Reflect.apply(target, thisArgument, argumentsList)
    },
  })

  return logger
}

// Adapted from https://github.com/googleapis/nodejs-logging-bunyan/blob/4de2b3dd9e8f6b336d9ca3609f775046a6f74424/src/middleware/express.ts
// This logs the request and response objects for all requests.
// It also shows nicely formatted request log in Logs Explorer.
export function createLoggingMiddleware({
  projectId,
  logger,
  excludeHttpRequestField,
}: {
  projectId: string
  logger: Logger
  // If true, the `httpRequest` field is excluded from the emitted log record for finished requests.
  // This is the one which shows the nicely formatted request summary in Logs Explorer.
  // This only applies to a Google environment (App Engine or Cloud Functions).
  // Defaults to false.
  excludeHttpRequestField?: boolean
}) {
  function makeChildLogger(trace: string, span?: string) {
    return logger.child(
      { [LOGGING_TRACE_KEY]: trace, [LOGGING_SPAN_KEY]: span },
      true /* simple child */,
    )
  }

  return (req: ServerRequest, res: ServerResponse, next: Function) => {
    const emitRequestLog = (
      httpRequest: HttpRequest,
      trace: string,
      span?: string,
      sampled?: boolean,
    ) => {
      const { requestUrl } = httpRequest
      const googleServiceName = getGoogleServiceName()
      const cloudFunctionName = process.env.K_SERVICE
      logger.info(
        {
          // Log more info about the request
          // See also the serializers for these fields
          req,
          res,
          ...(googleServiceName && !excludeHttpRequestField
            ? {
                // This shows the nicely formatted request log in Logs Explorer.
                // See https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest
                httpRequest: {
                  ...httpRequest,
                  // Add the Cloud Function name to the path so it's easier to see which function was called in Logs Explorer
                  // By default it only shows `/?${query}` and hides the function name (and execution id) pills
                  // from the summary line which are otherwise present when httpRequest is not set
                  requestUrl:
                    cloudFunctionName &&
                    requestUrl?.startsWith('/') &&
                    !requestUrl.startsWith(`/${cloudFunctionName}`)
                      ? `/${cloudFunctionName}${requestUrl}`
                      : requestUrl,
                },
                [LOGGING_TRACE_KEY]: trace,
                [LOGGING_SPAN_KEY]: span,
                [LOGGING_SAMPLED_KEY]: sampled,
              }
            : undefined),
        },
        'Request finished',
      )
    }
    commonMiddleware.express.makeMiddleware(
      projectId,
      makeChildLogger,
      emitRequestLog,
    )(req, res, next)
  }
}

// Simple heuristic to check if the error is from got
// See https://github.com/sindresorhus/got/blob/2b1482ca847867cbf24abde4d68e8063611e50d1/source/core/index.ts#L312
function isGotError(err: any) {
  return err.options && err.options.url
}

// Adapt the got options to a format that can be used by the default request serializer
function makeFakeRequestFromGotOptions(gotOptions: any) {
  return {
    method: gotOptions.method,
    url: gotOptions.url,
    headers: gotOptions.headers,
    body: gotOptions.body || gotOptions.json,
  }
}

// Simple heuristic to check if the error is from axios
// See https://axios-http.com/docs/handling_errors
function isAxiosError(err: any) {
  return err.isAxiosError && err.config
}

// Adapt the axios config to a format that can be used by the default request serializer
function makeFakeRequestFromAxiosConfig(axiosConfig: any) {
  // Try to parse the body if it's a JSON string
  let body = axiosConfig.data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      // If it's not valid JSON, keep it as a string
    }
  }

  return {
    method: axiosConfig.method,
    url: axiosConfig.url,
    headers: axiosConfig.headers,
    body,
  }
}

// Serialize axios response object, extracting safe properties to avoid circular references
function serializeAxiosResponse(axiosResponse: any) {
  if (!axiosResponse) {
    return axiosResponse
  }
  return {
    statusCode: axiosResponse.status,
    headers: axiosResponse.headers,
    body: axiosResponse.data,
  }
}

// Similar to the stdSerializers in bunyan, but with a few extra fields (query and body mostly)
export function createDetailedRequestSerializers() {
  const serializers: Logger.Serializers = {}

  serializers.req = (req: any) => {
    if (!req || !req.method) {
      return req
    }
    return {
      method: req.method,
      // Accept `req.originalUrl` for expressjs usage.
      // https://expressjs.com/en/api.html#req.originalUrl
      url: req.originalUrl || req.url,
      query: req.query,
      body: req.body,
      headers: req.headers,
      remoteAddress: req.connection?.remoteAddress,
      remotePort: req.connection?.remotePort,
    }
  }

  function responseSerializer(res: any, includeBody?: boolean) {
    if (!res || !res.statusCode) {
      return res
    }
    return {
      statusCode: res.statusCode,
      header: res._header,
      headers: res.headers,
      ...(includeBody ? { body: res.body } : undefined),
    }
  }

  serializers.res = responseSerializer

  serializers.err = (err: any) => {
    if (!err || !err.stack) {
      return err
    }

    const result = Logger.stdSerializers.err(err)

    if (isGotError(err)) {
      const response = err.response
      const request = makeFakeRequestFromGotOptions(err.options)

      // Add the request and response to the log record, when the error is from the got library
      return {
        ...result,
        request: serializers.req(request),
        response: responseSerializer(response, true),
      }
    }

    if (isAxiosError(err)) {
      const response = err.response
      const request = makeFakeRequestFromAxiosConfig(err.config)

      // Add the request and response to the log record, when the error is from the axios library
      return {
        ...result,
        request: serializers.req(request),
        response: serializeAxiosResponse(response),
      }
    }

    return result
  }

  return serializers
}

function bigIntReplacer(_: unknown, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
