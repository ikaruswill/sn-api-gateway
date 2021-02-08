import { NextFunction, Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { BaseMiddleware } from 'inversify-express-utils'
import { SuperAgentStatic } from 'superagent'
import { Logger } from 'winston'
import TYPES from '../Bootstrap/Types'

@injectable()
export class AuthMiddleware extends BaseMiddleware {
  constructor (
    @inject(TYPES.HTTPClient) private httpClient: SuperAgentStatic,
    @inject(TYPES.AUTH_SERVER_URL) private authServerUrl: string,
    @inject(TYPES.HTTP_CALL_TIMEOUT) private httpCallTimeout: number,
    @inject(TYPES.Logger) private logger: Logger
  ) {
    super()
  }

  async handler (request: Request, response: Response, next: NextFunction): Promise<void> {
    if (!request.headers.authorization) {
      response.status(401).send({
        error: {
          tag: 'invalid-auth',
          message: 'Invalid login credentials.'
        }
      })

      return
    }

    try {
      const authResponse = await this.httpClient
        .post(`${this.authServerUrl}/sessions/validate`)
        .timeout(this.httpCallTimeout)
        .set('Authorization', request.headers.authorization)
        .send()

      this.logger.debug('Auth validation response: %O', authResponse.body)

      response.locals.authToken = authResponse.body.authToken
    } catch (error) {
      this.logger.error('Could not pass the request to underlying services')

      this.logger.debug('Response error: %O', error.response)

      if (error.response.headers && error.response.headers['content-type']) {
        response.setHeader('content-type', error.response.headers['content-type'])
      }
      response.status(error.status).send(error.response.body)

      return
    }

    return next()
  }
}