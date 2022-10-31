import Logger from 'bunyan'
import express from 'express'
import request from 'supertest'
import { createLogger, createLoggingMiddleware } from './logging'
import MockDate from 'mockdate'

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
})

describe('logging middleware', () => {
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
  server.use(createLoggingMiddleware({ projectId: 'test-project', logger }))
  server.post('/', (req, res) => {
    // @ts-ignore
    logger.info({ req }, 'this helps ensure req is logged and not mutated')

    res.status(200).send({ message: 'OK' })
  })

  it('should log the request details once finished', async () => {
    await request(server)
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

    await request(server)
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
})
