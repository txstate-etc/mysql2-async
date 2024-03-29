import mysql, { type Pool, type PoolConnection, type PoolOptions, type ResultSetHeader } from 'mysql2'
import type { Pool as PromisePool, PoolConnection as PromisePoolConnection } from 'mysql2/promise'
import { Readable } from 'stream'

export type Mysql2AsyncQueryLogger = (sql: string, elapsedMs: number, rowsUpdated: number) => void | Promise<void>

export interface Mysql2AsyncOptions {
  logQueries?: Mysql2AsyncQueryLogger
}

export interface DbConfig extends PoolOptions, Mysql2AsyncOptions {
  skiptzfix?: boolean,
}

export interface QueryOptions {
  saveAsPrepared?: boolean
  nestTables?: true | '_'
  rowsAsArray?: boolean
}

export interface StreamOptions extends QueryOptions {
  highWaterMark?: number
}

interface canBeStringed {
  toString: () => string
}
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
interface BindObject { [keys: string]: BindParam }
type BindParam = boolean | number | string | null | undefined | Date | Buffer | canBeStringed | BindObject
type ColTypes = BindParam
type BindInput = BindParam[] | BindObject

interface StreamIterator <ReturnType> {
  [Symbol.asyncIterator]: () => StreamIterator<ReturnType>
  next: () => Promise<{ done?: false, value: ReturnType }>
  return: () => Promise<{ done: true, value: ReturnType }>
}

interface GenericReadable<T> extends Readable {
  [Symbol.asyncIterator]: () => StreamIterator<T>
}

export class Queryable {
  protected conn: PoolConnection | Pool
  protected promiseConn: PromisePoolConnection | PromisePool
  protected options: Mysql2AsyncOptions

  constructor (conn: PoolConnection | Pool, options: Mysql2AsyncOptions) {
    this.conn = conn
    this.promiseConn = (conn as any).promise()
    this.options = options
  }

  async query (sql: string, binds?: BindInput, options?: QueryOptions) {
    if (!options) options = {}
    if (typeof binds === 'object' && !Array.isArray(binds)) (options as any).namedPlaceholders = true
    try {
      const start = this.options.logQueries ? new Date().getTime() : undefined
      if (options?.saveAsPrepared) {
        const [result] = await this.promiseConn.execute({ ...options, sql, values: binds })
        this.options.logQueries?.(sql, new Date().getTime() - start!, 'affectedRows' in result ? result.affectedRows : 0)?.catch(console.error)
        return result
      } else {
        const [result] = await this.promiseConn.query({ ...options, sql, values: binds })
        this.options.logQueries?.(sql, new Date().getTime() - start!, 'affectedRows' in result ? result.affectedRows : 0)?.catch(console.error)
        return result
      }
    } catch (e: any) {
      e.clientstack = e.stack
      Error.captureStackTrace(e, this.query)
      throw e
    }
  }

  async getval<ReturnType = ColTypes> (sql: string, binds?: BindInput, options?: QueryOptions) {
    const row = await this.getrow<[ReturnType]>(sql, binds, { ...options, rowsAsArray: true })
    return row?.[0]
  }

  async getvals<ReturnType = ColTypes> (sql: string, binds?: BindInput, options?: QueryOptions) {
    const rows = await this.getall<[ReturnType]>(sql, binds, { ...options, rowsAsArray: true })
    return rows.map(r => r[0])
  }

  async getrow<ReturnType = any> (sql: string, binds?: BindInput, options?: QueryOptions) {
    const results = await this.query(sql, binds, options) as any[]
    if (results?.length > 0) return results?.[0] as ReturnType
  }

  async getall<ReturnType = any> (sql: string, binds?: BindInput, options?: QueryOptions) {
    const results = await this.query(sql, binds, options)
    return results as ReturnType[]
  }

  async execute (sql: string, binds?: BindInput, options?: QueryOptions) {
    await this.query(sql, binds, options)
    return true
  }

  async update (sql: string, binds?: BindInput, options?: QueryOptions) {
    const result = await this.query(sql, binds, options)
    return (result as ResultSetHeader).affectedRows
  }

  async delete (sql: string, binds?: BindInput, options?: QueryOptions) {
    return await this.update(sql, binds, options)
  }

  async insert <BindType extends BindInput = BindInput>(sql: string, binds?: BindType, options?: QueryOptions) {
    const result = await this.query(sql, binds, options)
    return (result as ResultSetHeader).insertId
  }

  protected feedStream<ReturnType> (stream: GenericReadable<ReturnType>, sql: string, binds: BindInput, options: QueryOptions = {}) {
    if (stream.destroyed) return

    const req = options?.saveAsPrepared ? (this.conn as any).execute({ ...options, sql, values: binds }) : this.conn.query({ ...options, sql, values: binds })
    const reqany: any = req
    let canceled = false
    const stacktraceError: { stack?: string } = {}
    Error.captureStackTrace(stacktraceError, this.feedStream)
    stream._read = () => {
      reqany._connection?.resume()
    }
    stream._destroy = (err: Error, cb) => {
      if (err) stream.emit('error', err)
      canceled = true
      reqany._connection?.resume()
      cb()
    }
    req.on('result', (row: any) => {
      if (canceled) return
      if (!stream.push(row)) {
        reqany._connection.pause()
      }
    })
    req.on('error', (err: Error) => {
      if (canceled) return;
      (err as any).clientstack = err.stack
      err.stack = (stacktraceError.stack ?? '').replace(/^Error:/, `Error: ${err.message}`)
      stream.emit('error', err)
    })
    req.on('end', () => {
      if (canceled) return
      stream.push(null)
    })
  }

  protected handleStreamOptions<ReturnType> (sql: string, bindsOrOptions: any, options?: StreamOptions) {
    let binds
    if (!options && (bindsOrOptions?.highWaterMark || bindsOrOptions?.objectMode)) {
      options = bindsOrOptions
      binds = []
    } else {
      binds = bindsOrOptions
    }
    const queryOptions: QueryOptions = {
      saveAsPrepared: options?.saveAsPrepared,
      nestTables: options?.nestTables,
      rowsAsArray: options?.rowsAsArray
    }
    const streamOptions = {
      highWaterMark: options?.highWaterMark
    }
    const stream = new Readable({ ...streamOptions, objectMode: true }) as GenericReadable<ReturnType>
    stream._read = () => {}
    stream._destroy = (err: Error, cb) => {
      if (err) stream.emit('error', err)
      cb()
    }
    return { binds, queryOptions, stream }
  }

  stream<ReturnType = any> (sql: string, options: StreamOptions): GenericReadable<ReturnType>
  stream<ReturnType = any> (sql: string, binds?: BindInput, options?: StreamOptions): GenericReadable<ReturnType>
  stream<ReturnType = any> (sql: string, bindsOrOptions: any, options?: StreamOptions) {
    const { binds, queryOptions, stream } = this.handleStreamOptions<ReturnType>(sql, bindsOrOptions, options)
    this.feedStream(stream, sql, binds, queryOptions)
    return stream
  }

  iterator<ReturnType = any> (sql: string, options: StreamOptions): StreamIterator<ReturnType>
  iterator<ReturnType = any> (sql: string, binds?: BindInput, options?: StreamOptions): StreamIterator<ReturnType>
  iterator<ReturnType = any> (sql: string, bindsOrOptions: any, options?: StreamOptions) {
    const ret = this.stream<ReturnType>(sql, bindsOrOptions, options)[Symbol.asyncIterator]()
    return ret
  }

  in (binds: BindInput, newbinds: BindParam[]) {
    const inElements: string[] = []
    if (Array.isArray(binds)) {
      for (const bind of newbinds) {
        if (Array.isArray(bind)) { // tuple
          binds.push(...bind)
          inElements.push(`(${bind.map(() => '?').join(',')})`)
        } else { // normal
          binds.push(bind)
          inElements.push('?')
        }
      }
    } else {
      let startindex = Object.keys(binds).length
      for (const bind of newbinds) {
        if (Array.isArray(bind)) { // tuple
          inElements.push(`(${bind.map((str, i) => `:bindin${i + startindex}`).join(',')})`)
          for (let i = 0; i < bind.length; i++) {
            binds[`bindin${i + startindex}`] = bind[i]
          }
          startindex += bind.length
        } else { // normal
          inElements.push(`:bindin${startindex}`)
          binds[`bindin${startindex}`] = bind
          startindex++
        }
      }
    }
    return inElements.join(',')
  }
}

export default class Db extends Queryable {
  protected pool: Pool

  constructor (config?: DbConfig) {
    const skiptzfix = (config?.skiptzfix ?? false) || Boolean(process.env.MYSQL_SKIPTZFIX)
    delete config?.skiptzfix
    const poolSizeString = process.env.MYSQL_POOL_SIZE ?? process.env.DB_POOL_SIZE
    const pool = mysql.createPool({
      ...config,
      host: config?.host ?? process.env.MYSQL_HOST ?? process.env.DB_HOST ?? 'mysql',
      port: config?.port ?? parseInt(process.env.MYSQL_PORT ?? process.env.DB_PORT ?? '3306'),
      user: config?.user ?? process.env.MYSQL_USER ?? process.env.DB_USER ?? 'root',
      password: config?.password ?? process.env.MYSQL_PASS ?? process.env.DB_PASS ?? 'secret',
      database: config?.database ?? process.env.MYSQL_DATABASE ?? process.env.DB_DATABASE ?? 'default_database',
      ssl: config?.ssl ?? (!['false', '0'].includes(process.env.MYSQL_SSL ?? process.env.DB_SSL ?? 'false') ? {} : undefined),
      // client side connectTimeout is unstable in mysql2 library
      // it throws an error you can't catch and crashes node
      // best to leave this at 0 (disabled)
      connectTimeout: 0,
      // to harden connections against failure https://github.com/sidorares/node-mysql2/issues/683
      // keepAliveInitialDelay: 10000,
      // enableKeepAlive: true,
      ...(!skiptzfix ? { timezone: 'Z' } : {}),
      ...(poolSizeString ? { connectionLimit: parseInt(poolSizeString) } : {}),
      flags: [...(config?.flags ?? []), ...(config?.flags?.some(f => f.includes('FOUND_ROWS')) ? [] : ['-FOUND_ROWS'])]
    })
    if (!skiptzfix) {
      pool.on('connection', function (connection: PoolConnection) {
        connection.query('SET time_zone="UTC"')
      })
    }
    super(pool, { logQueries: config?.logQueries })
    this.pool = pool
  }

  logQueries(logger?: Mysql2AsyncQueryLogger) {
    this.options.logQueries = logger
  }

  async wait () {
    while (true) {
      try {
        await this.getrow('select 1')
        break
      } catch (e: any) {
        if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          throw e
        }
      }
    }
  }

  async transaction <ReturnType> (callback: (db: Queryable) => Promise<ReturnType>, options?: { retries?: number, retryPause?: number, lockForWrite?: string[]|string, lockForRead?: string[]|string, unlockAfter?: boolean }): Promise<ReturnType> {
    const conn = await new Promise<PoolConnection>((resolve, reject) => {
      this.pool.getConnection((err: any, conn: PoolConnection) => {
        if (err) reject(err)
        else resolve(conn)
      })
    })
    let retries = options?.retries ?? 0
    const db = new Queryable(conn, this.options)
    try {
      while (true) {
        await db.execute('SET autocommit=0')
        try {
          if (options?.lockForRead || options?.lockForWrite) {
            const lockForRead = typeof options.lockForRead === 'string' ? [options.lockForRead] : (options.lockForRead ?? [])
            const lockForWrite = typeof options.lockForWrite === 'string' ? [options.lockForWrite] : (options.lockForWrite ?? [])
            await db.execute(`LOCK TABLES ${lockForRead.map(t => `${t} READ`).concat(lockForWrite.map(t => `${t} WRITE`)).join(', ') ?? ''}`)
          }
          const ret = await callback(db)
          await db.execute('COMMIT')
          return ret
        } catch (e: any) {
          await db.execute('ROLLBACK')
          if (e.errno === 1213 && retries > 0) { // deadlock and we're going to retry
            retries--
            // wait a random number of milliseconds to help avoid immediately re-colliding with the other process
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (options?.retryPause ?? 100))))
          } else { // not deadlock or we're done retrying
            throw e
          }
        } finally {
          if (options?.lockForRead || options?.lockForWrite || options?.unlockAfter) await db.execute('UNLOCK TABLES')
        }
      }
    } finally {
      await db.execute('SET autocommit=1')
      conn.release()
    }
  }
}
