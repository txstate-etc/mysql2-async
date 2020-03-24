import * as mysql from 'mysql'
export { Query } from 'mysql'

export interface RowDataPacket {
  constructor: {
    name: 'RowDataPacket'
  }
  [column: string]: any
  [column: number]: any
}

export interface OkPacket {
  constructor: {
    name: 'OkPacket'
  }
  fieldCount: number
  affectedRows: number
  changedRows: number
  insertId: number
  serverStatus: number
  warningCount: number
  message: string
  procotol41: boolean
}

export interface Connection extends mysql.Connection {
  execute: mysql.QueryFunction
}

export interface PoolConnection extends mysql.PoolConnection {
  execute: mysql.QueryFunction
}

export interface Pool extends mysql.Pool {
  execute: mysql.QueryFunction
  getConnection(callback: (err: mysql.MysqlError, connection: PoolConnection) => any): void
}

type authPlugins =
    (pluginMetadata: { connection: Connection, command: string }) =>
    (pluginData: Buffer) => Promise<string>;

export interface ConnectionOptions extends mysql.ConnectionOptions {
  charsetNumber?: number
  compress?: boolean
  authSwitchHandler?: (data: any, callback: () => void) => any
  connectAttributes?: { [param: string]: any }
  decimalNumbers?: boolean
  isServer?: boolean
  maxPreparedStatements?: number
  namedPlaceholders?: boolean
  nestTables?: boolean | string
  passwordSha1?: string
  pool?: any
  rowsAsArray?: boolean
  stream?: any
  uri?: string
  connectionLimit?: number
  Promise?: any
  queueLimit?: number
  waitForConnections?: boolean
  authPlugins?: {
    [key: string]: authPlugins
  }
}

export interface PoolOptions extends mysql.PoolConfig, ConnectionOptions {
  authPlugins?: {
    [key: string]: authPlugins
  }
}

export interface FieldInfo extends mysql.FieldInfo {
  columnType: number
  columnLength: number
  schema: string
  characterSet: number
}
