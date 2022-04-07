import mysql, { Pool, PoolConnection, PoolOptions, OkPacket } from 'mysql2'
import { Readable } from 'stream'

export interface DbConfig extends PoolOptions {
  skiptzfix?: boolean
}

export interface QueryOptions {
  saveAsPrepared?: boolean
  nestTables?: true|'_'
  rowsAsArray?: boolean
}

export interface StreamOptions extends QueryOptions {
  highWaterMark?: number
}

interface canBeStringed {
  toString: () => string
}
interface BindObject { [keys: string]: BindParam }
type BindParam = boolean|number|string|null|Date|Buffer|canBeStringed|BindObject
type ColTypes = BindParam
type BindInput = BindParam[]|BindObject

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

  constructor (conn: PoolConnection | Pool) {
    this.conn = conn
  }

  async query (sql: string, binds?: BindInput, options?: QueryOptions): Promise<any[] | any[][] | OkPacket | OkPacket[]> {
    if (!options) options = {}
    if (typeof binds === 'object' && !Array.isArray(binds)) (options as any).namedPlaceholders = true
    try {
      return await new Promise((resolve, reject) => {
        if (options?.saveAsPrepared) {
          this.conn.execute({ ...options, sql, values: binds }, (err, result) => {
            if (err) reject(err)
            else resolve(result as any)
          })
        } else {
          this.conn.query({ ...options, sql, values: binds }, (err, result) => {
            if (err) reject(err)
            else resolve(result as any)
          })
        }
      })
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
    return (result as OkPacket).affectedRows
  }

  async delete (sql: string, binds?: BindInput, options?: QueryOptions) {
    return await this.update(sql, binds, options)
  }

  async insert (sql: string, binds?: BindInput, options?: QueryOptions) {
    const result = await this.query(sql, binds, options)
    return (result as OkPacket).insertId
  }

  protected feedStream<ReturnType> (stream: GenericReadable<ReturnType>, sql: string, binds: BindInput, options: QueryOptions = {}) {
    if (stream.destroyed) return

    const req = options?.saveAsPrepared ? this.conn.execute({ ...options, sql, values: binds }) : this.conn.query({ ...options, sql, values: binds })
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
    req.on('error', err => {
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
    super(pool)
    this.pool = pool
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

  async transaction <ReturnType> (callback: (db: Queryable) => Promise<ReturnType>, options?: { retries?: number }): Promise<ReturnType> {
    const conn = await new Promise<PoolConnection>((resolve, reject) => {
      this.pool.getConnection((err: any, conn: PoolConnection) => {
        if (err) reject(err)
        else resolve(conn)
      })
    })
    const db = new Queryable(conn)
    try {
      await db.execute('START TRANSACTION')
      try {
        const ret = await callback(db)
        await db.execute('COMMIT')
        return ret
      } catch (e: any) {
        const isDeadlock = e.errno === 1213
        if (isDeadlock && options?.retries) {
          return await this.transaction(callback, { ...options, retries: options.retries - 1 })
        } else {
          if (!isDeadlock) await db.execute('ROLLBACK')
          throw e
        }
      }
    } finally {
      conn.release()
    }
  }
}
