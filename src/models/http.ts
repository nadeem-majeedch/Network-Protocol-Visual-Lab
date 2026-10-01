/**
 * HTTP message models (HTTP/1.1 shape, simplified for simulation).
 */

export type HttpMethod = 'GET' | 'POST' | 'HEAD';

export interface HttpHeaders {
  readonly [name: string]: string;
}

export interface HttpRequest {
  readonly kind: 'request';
  readonly method: HttpMethod;
  readonly path: string;
  readonly version: 'HTTP/1.1';
  readonly headers: HttpHeaders;
  readonly body?: string;
}

export interface HttpResponse {
  readonly kind: 'response';
  readonly status: number;
  readonly reason: string;
  readonly version: 'HTTP/1.1';
  readonly headers: HttpHeaders;
  readonly body?: string;
}

export type HttpMessage = HttpRequest | HttpResponse;
