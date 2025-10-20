import Logger from 'bunyan'
import express from 'express'
import request from 'supertest'
import { createLogger, createLoggingMiddleware } from './logging'
import MockDate from 'mockdate'
import got from 'got'
import axios from 'axios'
import nodeFetch from 'node-fetch'
import { promisify } from 'util'

MockDate.set(new Date('2022-10-18T23:36:07.071Z'))

// @ts-ignore
const spyLoggerEmit = jest.spyOn(Logger.prototype, '_emit')

const currentProcessEnv = process.env

const DEFAULT_PROPERTY_MATCHER = {
  hostname: expect.any(String),
  pid: expect.any(Number),
}

function globalReplacePhoneNumbers(value: string) {
  // replaces values that look like phone numbers
  // `%2B` is the URL encoded version of `+`
  return value.replace(
    /(?:\+|%2B)[1-9]\d{1,14}/gi,
    (phoneNumber) => phoneNumber.slice(0, -4) + 'XXXX',
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...currentProcessEnv }
})

describe('logger', () => {
  it("should log at the default 'info' level and above", () => {
    const logger = createLogger()
    logger.trace('logger.trace')
    expect(spyLoggerEmit).not.toHaveBeenCalled()
    logger.debug('logger.debug')
    expect(spyLoggerEmit).not.toHaveBeenCalled()
    logger.info('logger.info')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 30, msg: 'logger.info' }),
    )
    logger.warn('logger.warn')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 40, msg: 'logger.warn' }),
    )
    logger.error('logger.error')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 50, msg: 'logger.error' }),
    )
    logger.fatal('logger.fatal')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 60, msg: 'logger.fatal' }),
    )
  })

  it('should log at the provided level and above', () => {
    const logger = createLogger({ level: 'warn' })
    logger.trace('logger.trace')
    expect(spyLoggerEmit).not.toHaveBeenCalled()
    logger.debug('logger.debug')
    expect(spyLoggerEmit).not.toHaveBeenCalled()
    logger.info('logger.info')
    expect(spyLoggerEmit).not.toHaveBeenCalled()
    logger.warn('logger.warn')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 40, msg: 'logger.warn' }),
    )
    logger.error('logger.error')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 50, msg: 'logger.error' }),
    )
    logger.fatal('logger.fatal')
    expect(spyLoggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 60, msg: 'logger.fatal' }),
    )
  })

  it('should redact specific keys', async () => {
    const logger = createLogger({
      redact: {
        paths: ['a.*.c'],
      },
    })
    logger.info(
      { a: { b: { c: 'Call me at +1234567890' } } },
      "I'm a phone number +1234567890",
    )
    expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
    expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
      DEFAULT_PROPERTY_MATCHER,
      `
      {
        "a": {
          "b": {
            "c": "[REDACTED]",
          },
        },
        "hostname": Any<String>,
        "level": 30,
        "msg": "I'm a phone number +1234567890",
        "name": "default",
        "pid": Any<Number>,
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should redact global patterns', async () => {
    const logger = createLogger({
      redact: {
        globalReplace: globalReplacePhoneNumbers,
      },
    })
    logger.info(
      { a: { b: { c: 'Call me at +1234567890' } } },
      "I'm a phone number +1234567890",
    )
    expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
    expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
      DEFAULT_PROPERTY_MATCHER,
      `
      {
        "a": {
          "b": {
            "c": "Call me at +123456XXXX",
          },
        },
        "hostname": Any<String>,
        "level": 30,
        "msg": "I'm a phone number +123456XXXX",
        "name": "default",
        "pid": Any<Number>,
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should redact using a custom censor value', async () => {
    const logger = createLogger({
      redact: {
        paths: ['a.*.c'],
        censor: '***REDACTED***',
      },
    })
    logger.info(
      { a: { b: { c: 'Call me at +1234567890' } } },
      "I'm a phone number +1234567890",
    )
    expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
    expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
      DEFAULT_PROPERTY_MATCHER,
      `
      {
        "a": {
          "b": {
            "c": "***REDACTED***",
          },
        },
        "hostname": Any<String>,
        "level": 30,
        "msg": "I'm a phone number +1234567890",
        "name": "default",
        "pid": Any<Number>,
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should transfrom BigInt values to strings', async () => {
    const logger = createLogger()
    logger.info(
      { a: { b: { c: 10n, d: 'Text' }, e: 20n }, f: 30n },
      'I have BigInt',
    )
    expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
    expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
      DEFAULT_PROPERTY_MATCHER,
      `
      {
        "a": {
          "b": {
            "c": "10",
            "d": "Text",
          },
          "e": "20",
        },
        "f": "30",
        "hostname": Any<String>,
        "level": 30,
        "msg": "I have BigInt",
        "name": "default",
        "pid": Any<Number>,
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })
})

describe('logging middleware', () => {
  function createServer(
    middlewareOptions?: Partial<Parameters<typeof createLoggingMiddleware>[0]>,
  ) {
    const logger = createLogger({
      redact: {
        paths: [
          'pepper',
          '*.pepper',
          'req.*.pepper',
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: (_value: any) => {
          return '***REDACTED***'
        },
        globalReplace: globalReplacePhoneNumbers,
      },
    })
    const server = express()
    server.use(
      createLoggingMiddleware({
        projectId: 'test-project',
        logger,
        ...middlewareOptions,
      }),
    )
    server.post('/', (req, res) => {
      // @ts-ignore
      logger.info({ req }, 'this helps ensure req is logged and not mutated')

      res.status(200).send({ message: 'OK' })
    })

    return server
  }

  it('should log the request details once finished', async () => {
    await request(createServer())
      .post('/?anotherPhone=%2B1234567890')
      .send({
        phoneNumber: '+1234567890',
      })
      .set('Content-Type', 'application/json')
      .set('Authorization', 'SECRET_AUTH_HEADER')
      .expect(200)
      .expect({ message: 'OK' })

    expect(spyLoggerEmit).toHaveBeenCalledTimes(2)
    expect(spyLoggerEmit.mock.calls[1][0]).toMatchInlineSnapshot(
      {
        ...DEFAULT_PROPERTY_MATCHER,
        req: {
          headers: {
            host: expect.any(String),
            'x-cloud-trace-context': expect.any(String),
          },
          remotePort: expect.any(Number),
        },
        res: {
          // Can't mock the Date there
          // See https://github.com/sinonjs/fake-timers/issues/344
          header: expect.any(String),
        },
      },
      `
      {
        "hostname": Any<String>,
        "level": 30,
        "msg": "Request finished",
        "name": "default",
        "pid": Any<Number>,
        "req": {
          "headers": {
            "accept-encoding": "gzip, deflate",
            "authorization": "***REDACTED***",
            "connection": "close",
            "content-length": "29",
            "content-type": "application/json",
            "host": Any<String>,
            "x-cloud-trace-context": Any<String>,
          },
          "method": "POST",
          "query": {
            "anotherPhone": "+123456XXXX",
          },
          "remoteAddress": "::ffff:127.0.0.1",
          "remotePort": Any<Number>,
          "url": "/?anotherPhone=%2B123456XXXX",
        },
        "res": {
          "header": Any<String>,
          "statusCode": 200,
        },
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should log the request details with additional fields in a Cloud Functions environment once finished', async () => {
    // Simulate a Cloud Functions environment
    process.env.K_SERVICE = 'testLogger'

    await request(createServer())
      .post('/?anotherPhone=%2B1234567890')
      .send({
        phoneNumber: '+1234567890',
      })
      .set('Content-Type', 'application/json')
      .set('Authorization', 'SECRET_AUTH_HEADER')
      .expect(200)
      .expect({ message: 'OK' })

    expect(spyLoggerEmit).toHaveBeenCalledTimes(2)
    expect(spyLoggerEmit.mock.calls[1][0]).toMatchInlineSnapshot(
      {
        ...DEFAULT_PROPERTY_MATCHER,
        req: {
          headers: {
            host: expect.any(String),
            'x-cloud-trace-context': expect.any(String),
          },

          remotePort: expect.any(Number),
        },

        res: {
          // Can't mock the Date there
          // See https://github.com/sinonjs/fake-timers/issues/344
          header: expect.any(String),
        },

        'logging.googleapis.com/spanId': expect.any(String),
        'logging.googleapis.com/trace': expect.any(String),
      },
      `
      {
        "hostname": Any<String>,
        "httpRequest": {
          "requestMethod": "POST",
          "requestUrl": "/testLogger/?anotherPhone=%2B123456XXXX",
          "responseSize": 16,
          "status": 200,
        },
        "level": 30,
        "logging.googleapis.com/spanId": Any<String>,
        "logging.googleapis.com/trace": Any<String>,
        "logging.googleapis.com/trace_sampled": false,
        "msg": "Request finished",
        "name": "testLogger",
        "pid": Any<Number>,
        "req": {
          "headers": {
            "accept-encoding": "gzip, deflate",
            "authorization": "***REDACTED***",
            "connection": "close",
            "content-length": "29",
            "content-type": "application/json",
            "host": Any<String>,
            "x-cloud-trace-context": Any<String>,
          },
          "method": "POST",
          "query": {
            "anotherPhone": "+123456XXXX",
          },
          "remoteAddress": "::ffff:127.0.0.1",
          "remotePort": Any<Number>,
          "url": "/?anotherPhone=%2B123456XXXX",
        },
        "res": {
          "header": Any<String>,
          "statusCode": 200,
        },
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should log the request details with additional fields in an App Engine environment once finished', async () => {
    // Simulate an App Engine environment
    process.env.GAE_SERVICE = 'test-service'

    await request(createServer())
      .post('/?anotherPhone=%2B1234567890')
      .send({
        phoneNumber: '+1234567890',
      })
      .set('Content-Type', 'application/json')
      .set('Authorization', 'SECRET_AUTH_HEADER')
      .expect(200)
      .expect({ message: 'OK' })

    expect(spyLoggerEmit).toHaveBeenCalledTimes(2)
    expect(spyLoggerEmit.mock.calls[1][0]).toMatchInlineSnapshot(
      {
        ...DEFAULT_PROPERTY_MATCHER,
        req: {
          headers: {
            host: expect.any(String),
            'x-cloud-trace-context': expect.any(String),
          },

          remotePort: expect.any(Number),
        },

        res: {
          // Can't mock the Date there
          // See https://github.com/sinonjs/fake-timers/issues/344
          header: expect.any(String),
        },

        'logging.googleapis.com/spanId': expect.any(String),
        'logging.googleapis.com/trace': expect.any(String),
      },
      `
      {
        "hostname": Any<String>,
        "httpRequest": {
          "requestMethod": "POST",
          "requestUrl": "/?anotherPhone=%2B123456XXXX",
          "responseSize": 16,
          "status": 200,
        },
        "level": 30,
        "logging.googleapis.com/spanId": Any<String>,
        "logging.googleapis.com/trace": Any<String>,
        "logging.googleapis.com/trace_sampled": false,
        "msg": "Request finished",
        "name": "test-service",
        "pid": Any<Number>,
        "req": {
          "headers": {
            "accept-encoding": "gzip, deflate",
            "authorization": "***REDACTED***",
            "connection": "close",
            "content-length": "29",
            "content-type": "application/json",
            "host": Any<String>,
            "x-cloud-trace-context": Any<String>,
          },
          "method": "POST",
          "query": {
            "anotherPhone": "+123456XXXX",
          },
          "remoteAddress": "::ffff:127.0.0.1",
          "remotePort": Any<Number>,
          "url": "/?anotherPhone=%2B123456XXXX",
        },
        "res": {
          "header": Any<String>,
          "statusCode": 200,
        },
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  it('should exclude the httpRequest field in an Google environment when the option is specified', async () => {
    // Simulate an App Engine environment
    process.env.GAE_SERVICE = 'test-service'

    await request(createServer({ excludeHttpRequestField: true }))
      .post('/?anotherPhone=%2B1234567890')
      .send({
        phoneNumber: '+1234567890',
      })
      .set('Content-Type', 'application/json')
      .set('Authorization', 'SECRET_AUTH_HEADER')
      .expect(200)
      .expect({ message: 'OK' })

    expect(spyLoggerEmit).toHaveBeenCalledTimes(2)
    const logRecord = spyLoggerEmit.mock.calls[1][0]
    expect(logRecord).not.toHaveProperty('httpRequest')
    expect(logRecord).toHaveProperty('req')
  })
})

describe('logger serialization', () => {
  let listeningServer: any

  afterEach(async () => {
    if (!listeningServer) {
      return
    }

    const close = promisify(listeningServer.close.bind(listeningServer))
    await close()
    listeningServer = undefined
  })

  it('should work with an empty error object', async () => {
    const logger = createLogger()

    logger.error({ err: {} }, 'We have an empty error object')

    expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
    expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
      { ...DEFAULT_PROPERTY_MATCHER },
      `
      {
        "err": {},
        "hostname": Any<String>,
        "level": 50,
        "msg": "We have an empty error object",
        "name": "default",
        "pid": Any<Number>,
        "time": 2022-10-18T23:36:07.071Z,
        "v": 0,
      }
    `,
    )
  })

  describe('got library errors', () => {
    it('should add request details when the request fails to connect', async () => {
      const logger = createLogger()
      const gotError = await got
        // This will fail because there's no server listening
        .post('http://127.0.0.1:12345', {
          json: {
            foo: 'bar',
          },
        })
        .catch((err) => err)

      logger.error({ err: gotError }, 'We have a got error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        {
          ...DEFAULT_PROPERTY_MATCHER,
          err: {
            // Ignore stack as it's changes between Node versions
            stack: expect.any(String),
          },
        },
        `
        {
          "err": {
            "code": "ECONNREFUSED",
            "message": "connect ECONNREFUSED 127.0.0.1:12345",
            "name": "RequestError",
            "request": {
              "body": {
                "foo": "bar",
              },
              "headers": {
                "accept-encoding": "gzip, deflate, br",
                "content-length": "13",
                "content-type": "application/json",
                "user-agent": "got (https://github.com/sindresorhus/got)",
              },
              "method": "POST",
              "url": "http://127.0.0.1:12345/",
            },
            "stack": Any<String>,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have a got error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })

    it('should add request and response details when the server response is not successful', async () => {
      listeningServer = express().listen(42424)
      const logger = createLogger()
      const gotError = await got
        .post(`http://127.0.0.1:42424/does-not-exist`, {
          json: {
            foo: 'bar',
          },
        })
        .catch((err) => err)

      logger.error({ err: gotError }, 'We have a got error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        {
          ...DEFAULT_PROPERTY_MATCHER,
          err: {
            // Ignore stack as it's changes between Node versions
            stack: expect.any(String),
            response: {
              headers: {
                date: expect.any(String),
                // Ignore connection-related headers as they can vary
                connection: expect.any(String),
              },
            },
          },
        },
        `
        {
          "err": {
            "code": "ERR_NON_2XX_3XX_RESPONSE",
            "message": "Response code 404 (Not Found)",
            "name": "HTTPError",
            "request": {
              "body": {
                "foo": "bar",
              },
              "headers": {
                "accept-encoding": "gzip, deflate, br",
                "content-length": "13",
                "content-type": "application/json",
                "user-agent": "got (https://github.com/sindresorhus/got)",
              },
              "method": "POST",
              "url": "http://127.0.0.1:42424/does-not-exist",
            },
            "response": {
              "body": "<!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <title>Error</title>
        </head>
        <body>
        <pre>Cannot POST /does-not-exist</pre>
        </body>
        </html>
        ",
              "headers": {
                "connection": Any<String>,
                "content-length": "154",
                "content-security-policy": "default-src 'none'",
                "content-type": "text/html; charset=utf-8",
                "date": Any<String>,
                "keep-alive": "timeout=5",
                "x-content-type-options": "nosniff",
              },
              "statusCode": 404,
            },
            "stack": Any<String>,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have a got error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })
  })

  describe('axios library errors', () => {
    it('should add request details when the request fails to connect', async () => {
      const logger = createLogger()
      const axiosError = await axios
        // This will fail because there's no server listening
        .post('http://127.0.0.1:12345', {
          foo: 'bar',
        })
        .catch((err) => err)

      logger.error({ err: axiosError }, 'We have an axios error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        {
          ...DEFAULT_PROPERTY_MATCHER,
          err: {
            // Ignore stack as it's changes between Node versions
            stack: expect.any(String),
            request: {
              headers: {
                // Ignore User-Agent as it changes between axios versions
                'User-Agent': expect.any(String),
              },
            },
          },
        },
        `
        {
          "err": {
            "code": "ECONNREFUSED",
            "message": "connect ECONNREFUSED 127.0.0.1:12345",
            "name": "Error",
            "request": {
              "body": {
                "foo": "bar",
              },
              "headers": {
                "Accept": "application/json, text/plain, */*",
                "Accept-Encoding": "gzip, compress, deflate, br",
                "Content-Length": "13",
                "Content-Type": "application/json",
                "User-Agent": Any<String>,
              },
              "method": "post",
              "url": "http://127.0.0.1:12345",
            },
            "stack": Any<String>,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have an axios error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })

    it('should add request and response details when the server response is not successful', async () => {
      listeningServer = express().listen(42425)
      const logger = createLogger()
      const axiosError = await axios
        .post(`http://127.0.0.1:42425/does-not-exist`, {
          foo: 'bar',
        })
        .catch((err) => err)

      logger.error({ err: axiosError }, 'We have an axios error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        {
          ...DEFAULT_PROPERTY_MATCHER,
          err: {
            // Ignore stack as it's changes between Node versions
            stack: expect.any(String),
            request: {
              headers: {
                // Ignore User-Agent as it changes between axios versions
                'User-Agent': expect.any(String),
              },
            },
            response: {
              headers: {
                date: expect.any(String),
                // Ignore connection-related headers as they can vary
                connection: expect.any(String),
              },
            },
          },
        },
        `
        {
          "err": {
            "code": "ERR_BAD_REQUEST",
            "message": "Request failed with status code 404",
            "name": "AxiosError",
            "request": {
              "body": {
                "foo": "bar",
              },
              "headers": {
                "Accept": "application/json, text/plain, */*",
                "Accept-Encoding": "gzip, compress, deflate, br",
                "Content-Length": "13",
                "Content-Type": "application/json",
                "User-Agent": Any<String>,
              },
              "method": "post",
              "url": "http://127.0.0.1:42425/does-not-exist",
            },
            "response": {
              "body": "<!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <title>Error</title>
        </head>
        <body>
        <pre>Cannot POST /does-not-exist</pre>
        </body>
        </html>
        ",
              "headers": {
                "connection": Any<String>,
                "content-length": "154",
                "content-security-policy": "default-src 'none'",
                "content-type": "text/html; charset=utf-8",
                "date": Any<String>,
                "keep-alive": "timeout=5",
                "x-content-type-options": "nosniff",
              },
              "statusCode": 404,
            },
            "stack": Any<String>,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have an axios error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })
  })

  describe('node-fetch library errors', () => {
    // TODO: support request/response details for node-fetch
    it('should work when the request fails to connect', async () => {
      const logger = createLogger()
      const nodeFetchError = await nodeFetch(
        // This will fail because there's no server listening
        'http://127.0.0.1:12345',
        {
          method: 'POST',
          body: JSON.stringify({
            foo: 'bar',
          }),
        },
      ).catch((err) => err)

      logger.error({ err: nodeFetchError }, 'We have a node-fetch error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        {
          ...DEFAULT_PROPERTY_MATCHER,
          err: {
            // Ignore stack as it's changes between Node versions
            stack: expect.any(String),
          },
        },
        `
        {
          "err": {
            "code": "ECONNREFUSED",
            "message": "request to http://127.0.0.1:12345/ failed, reason: connect ECONNREFUSED 127.0.0.1:12345",
            "name": "FetchError",
            "stack": Any<String>,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have a node-fetch error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })

    // TODO: support request/response details for node-fetch
    it('should work when the server response is not successful', async () => {
      listeningServer = express().listen(42424)
      const logger = createLogger()
      const nodeFetchError = await nodeFetch(
        `http://127.0.0.1:42424/does-not-exist`,
        {
          method: 'POST',
          body: JSON.stringify({
            foo: 'bar',
          }),
        },
      ).catch((err) => err)

      logger.error({ err: nodeFetchError }, 'We have a node-fetch error')

      expect(spyLoggerEmit).toHaveBeenCalledTimes(1)
      expect(spyLoggerEmit.mock.calls[0][0]).toMatchInlineSnapshot(
        { ...DEFAULT_PROPERTY_MATCHER },
        `
        {
          "err": {
            "size": 0,
            "timeout": 0,
          },
          "hostname": Any<String>,
          "level": 50,
          "msg": "We have a node-fetch error",
          "name": "default",
          "pid": Any<Number>,
          "time": 2022-10-18T23:36:07.071Z,
          "v": 0,
        }
      `,
      )
    })
  })
})
