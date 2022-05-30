import * as winston from 'winston'
import axios, { AxiosInstance } from 'axios'
import * as IORedis from 'ioredis'
import { Container } from 'inversify'
import * as AWS from 'aws-sdk'
import { AnalyticsStoreInterface, RedisAnalyticsStore } from '@standardnotes/analytics'
import { RedisDomainEventPublisher, SNSDomainEventPublisher } from '@standardnotes/domain-events-infra'
import { Timer, TimerInterface } from '@standardnotes/time'

import { Env } from './Env'
import TYPES from './Types'
import { AuthMiddleware } from '../Controller/AuthMiddleware'
import { HttpServiceInterface } from '../Service/Http/HttpServiceInterface'
import { HttpService } from '../Service/Http/HttpService'
import { SubscriptionTokenAuthMiddleware } from '../Controller/SubscriptionTokenAuthMiddleware'
import { AnalyticsMiddleware } from '../Controller/AnalyticsMiddleware'
import { CrossServiceTokenCacheInterface } from '../Service/Cache/CrossServiceTokenCacheInterface'
import { RedisCrossServiceTokenCache } from '../Infra/Redis/RedisCrossServiceTokenCache'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const newrelicWinstonEnricher = require('@newrelic/winston-enricher')

export class ContainerConfigLoader {
  async load(): Promise<Container> {
    const env: Env = new Env()
    env.load()

    const container = new Container()

    const winstonFormatters = [
      winston.format.splat(),
      winston.format.json(),
    ]
    if (env.get('NEW_RELIC_ENABLED', true) === 'true') {
      winstonFormatters.push(newrelicWinstonEnricher())
    }

    const logger = winston.createLogger({
      level: env.get('LOG_LEVEL') || 'info',
      format: winston.format.combine(...winstonFormatters),
      transports: [
        new winston.transports.Console({ level: env.get('LOG_LEVEL') || 'info' }),
      ],
    })
    container.bind<winston.Logger>(TYPES.Logger).toConstantValue(logger)

    const redisUrl = env.get('REDIS_URL')
    const isRedisInClusterMode = redisUrl.indexOf(',') > 0
    let redis
    if (isRedisInClusterMode) {
      redis = new IORedis.Cluster(redisUrl.split(','))
    } else {
      redis = new IORedis(redisUrl)
    }
    container.bind(TYPES.Redis).toConstantValue(redis)

    if (env.get('SNS_AWS_REGION', true)) {
      container.bind<AWS.SNS>(TYPES.SNS).toConstantValue(new AWS.SNS({
        apiVersion: 'latest',
        region: env.get('SNS_AWS_REGION', true),
      }))
    }

    container.bind<AxiosInstance>(TYPES.HTTPClient).toConstantValue(axios.create())

    // env vars
    container.bind(TYPES.SYNCING_SERVER_JS_URL).toConstantValue(env.get('SYNCING_SERVER_JS_URL'))
    container.bind(TYPES.AUTH_SERVER_URL).toConstantValue(env.get('AUTH_SERVER_URL'))
    container.bind(TYPES.PAYMENTS_SERVER_URL).toConstantValue(env.get('PAYMENTS_SERVER_URL', true))
    container.bind(TYPES.FILES_SERVER_URL).toConstantValue(env.get('FILES_SERVER_URL', true))
    container.bind(TYPES.AUTH_JWT_SECRET).toConstantValue(env.get('AUTH_JWT_SECRET'))
    container.bind(TYPES.HTTP_CALL_TIMEOUT).toConstantValue(env.get('HTTP_CALL_TIMEOUT', true) ? +env.get('HTTP_CALL_TIMEOUT', true) : 60_000)
    container.bind(TYPES.VERSION).toConstantValue(env.get('VERSION'))
    container.bind(TYPES.SNS_TOPIC_ARN).toConstantValue(env.get('SNS_TOPIC_ARN', true))
    container.bind(TYPES.SNS_AWS_REGION).toConstantValue(env.get('SNS_AWS_REGION', true))
    container.bind(TYPES.REDIS_EVENTS_CHANNEL).toConstantValue(env.get('REDIS_EVENTS_CHANNEL'))
    container.bind(TYPES.CROSS_SERVICE_TOKEN_CACHE_TTL).toConstantValue(+env.get('CROSS_SERVICE_TOKEN_CACHE_TTL', true))

    // Middleware
    container.bind<AuthMiddleware>(TYPES.AuthMiddleware).to(AuthMiddleware)
    container.bind<SubscriptionTokenAuthMiddleware>(TYPES.SubscriptionTokenAuthMiddleware).to(SubscriptionTokenAuthMiddleware)
    container.bind<AnalyticsMiddleware>(TYPES.AnalyticsMiddleware).to(AnalyticsMiddleware)

    // Services
    container.bind<HttpServiceInterface>(TYPES.HTTPService).to(HttpService)
    container.bind<AnalyticsStoreInterface>(TYPES.AnalyticsStore).toConstantValue(new RedisAnalyticsStore(
      container.get(TYPES.Redis)
    ))
    container.bind<CrossServiceTokenCacheInterface>(TYPES.CrossServiceTokenCache).to(RedisCrossServiceTokenCache)
    container.bind<TimerInterface>(TYPES.Timer).toConstantValue(new Timer())

    if (env.get('SNS_TOPIC_ARN', true)) {
      container.bind<SNSDomainEventPublisher>(TYPES.DomainEventPublisher).toConstantValue(
        new SNSDomainEventPublisher(
          container.get(TYPES.SNS),
          container.get(TYPES.SNS_TOPIC_ARN)
        )
      )
    } else {
      container.bind<RedisDomainEventPublisher>(TYPES.DomainEventPublisher).toConstantValue(
        new RedisDomainEventPublisher(
          container.get(TYPES.Redis),
          container.get(TYPES.REDIS_EVENTS_CHANNEL)
        )
      )
    }

    return container
  }
}
