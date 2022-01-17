import { AxiosInstance, AxiosResponse, Method } from 'axios'
import { Request, Response } from 'express'
import { inject, injectable } from 'inversify'
import { Logger } from 'winston'

import TYPES from '../Bootstrap/Types'
import { HttpServiceInterface } from './HttpClientInterface'

@injectable()
export class HttpService implements HttpServiceInterface {
  constructor(
    @inject(TYPES.HTTPClient) private httpClient: AxiosInstance,
    @inject(TYPES.AUTH_SERVER_URL) private authServerUrl: string,
    @inject(TYPES.FILES_SERVER_URL) private filesServerUrl: string,
    @inject(TYPES.SYNCING_SERVER_JS_URL) private syncingServerJsUrl: string,
    @inject(TYPES.PAYMENTS_SERVER_URL) private paymentsServerUrl: string,
    @inject(TYPES.HTTP_CALL_TIMEOUT) private httpCallTimeout: number,
    @inject(TYPES.Logger) private logger: Logger,
  ) {
  }

  async callSyncingServer(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    await this.callServer(this.syncingServerJsUrl, request, response, endpoint, payload)
  }

  async callLegacySyncingServer(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    await this.callServerWithLegacyFormat(this.syncingServerJsUrl, request, response, endpoint, payload)
  }

  async callAuthServer(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    await this.callServer(this.authServerUrl, request, response, endpoint, payload)
  }

  async callFilesServer(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    if (!this.filesServerUrl) {
      this.logger.debug('Files Server URL not defined. Skipped request to Files API.')

      return
    }

    await this.callServer(this.filesServerUrl, request, response, endpoint, payload)
  }

  async callPaymentsServer(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    if (!this.paymentsServerUrl) {
      this.logger.debug('Payments Server URL not defined. Skipped request to Payments API.')

      return
    }
    await this.callServerWithLegacyFormat(this.paymentsServerUrl, request, response, endpoint, payload)
  }

  async callAuthServerWithLegacyFormat(request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    await this.callServerWithLegacyFormat(this.authServerUrl, request, response, endpoint, payload)
  }

  private async getServerResponse(serverUrl: string, request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<AxiosResponse | undefined> {
    try {
      const headers: Record<string, string> = {}
      for (const headerName of Object.keys(request.headers)) {
        headers[headerName] = request.headers[headerName] as string
      }

      delete headers.host
      delete headers['content-length']

      if (response.locals.authToken) {
        headers['X-Auth-Token'] = response.locals.authToken
      }

      if (response.locals.offlineAuthToken) {
        headers['X-Auth-Offline-Token'] = response.locals.offlineAuthToken
      }

      this.logger.debug(`Calling [${request.method}] ${serverUrl}/${endpoint},
        headers: ${JSON.stringify(headers)},
        query: ${JSON.stringify(request.query)},
        payload: ${JSON.stringify(payload)}`)

      const serviceResponse = await this.httpClient.request({
        method: request.method as Method,
        headers,
        url: `${serverUrl}/${endpoint}`,
        data: this.getRequestData(payload),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        params: request.query,
        timeout: this.httpCallTimeout,
        validateStatus: (status: number) => {
          return status >= 200 && status < 500
        },
      })

      return serviceResponse
    } catch (error) {
      this.logger.error(`Could not pass the request to ${serverUrl}/${endpoint} on underlying service: ${error.response ? JSON.stringify(error.response.body) : error.message}`)

      this.logger.debug('Response error: %O', error.response ?? error)

      if (error.response?.header?.['content-type']) {
        response.setHeader('content-type', error.response.header['content-type'])
      }
      response.status(error.status || 500).send(error.response ? error.response.body : error.message)
    }

    return
  }

  private async callServer(serverUrl: string, request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    const serviceResponse = await this.getServerResponse(serverUrl, request, response, endpoint, payload)

    this.logger.debug(`Response from underlying server: ${JSON.stringify(serviceResponse?.data)},
      headers: ${JSON.stringify(serviceResponse?.headers)}`)

    if (!serviceResponse) {
      return
    }

    this.applyResponseHeaders(serviceResponse, response)

    response.status(serviceResponse.status).send({
      meta: {
        auth: {
          userUuid: response.locals.userUuid,
          roles: response.locals.roles,
        },
      },
      data: serviceResponse.data,
    })
  }

  private async callServerWithLegacyFormat(serverUrl: string, request: Request, response: Response, endpoint: string, payload?: Record<string, unknown> | string): Promise<void> {
    const serviceResponse = await this.getServerResponse(serverUrl, request, response, endpoint, payload)

    if (!serviceResponse) {
      return
    }

    this.applyResponseHeaders(serviceResponse, response)

    if (serviceResponse.request._redirectable._redirectCount > 0) {
      response.status(302).redirect(serviceResponse.request.res.responseUrl)
    } else {
      response.status(serviceResponse.status).send(serviceResponse.data)
    }
  }

  private getRequestData(payload: Record<string, unknown> | string | undefined): Record<string, unknown> | string | undefined {
    if (
      payload === '' ||
      payload === null ||
      payload === undefined ||
      (typeof payload === 'object' && Object.keys(payload).length === 0)
    ) {
      return undefined
    }

    return payload
  }

  private applyResponseHeaders(serviceResponse: AxiosResponse, response: Response): void {
    const returnedHeadersFromUnderlyingService = [
      'access-control-allow-methods',
      'access-control-allow-origin',
      'access-control-expose-headers',
      'authorization',
      'content-type',
      'x-ssjs-version',
      'x-auth-version',
    ]

    returnedHeadersFromUnderlyingService.map((headerName) => {
      const headerValue = serviceResponse.headers[headerName]
      if (headerValue) {
        response.setHeader(headerName, headerValue)
      }
    })
  }
}
