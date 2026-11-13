import { expect, test } from 'bun:test'
import { cleanAddress, serverProblem, socketUrl } from '../src/lib/net/address'

test('pasted addresses become server addresses', () => {
  expect(cleanAddress('  rooms.example.com/ ')).toBe('rooms.example.com')
  expect(cleanAddress('localhost:7778')).toBe('localhost:7778')
  expect(cleanAddress('https://keyfall.app/?server=rooms1.example.com#room=ABCDE')).toBe('rooms1.example.com')
  expect(cleanAddress('http://192.168.1.5:7777/#room=ABCDE')).toBe('http://192.168.1.5:7777')
  expect(cleanAddress('wss://rooms.example.com/ws')).toBe('wss://rooms.example.com')
})

test('socket addresses follow the page: plain on http, secure on https', () => {
  expect(socketUrl('rooms.example.com', false)).toBe('ws://rooms.example.com:7777/ws')
  expect(socketUrl('rooms.example.com', true)).toBe('wss://rooms.example.com/ws')
  expect(socketUrl('http://10.0.0.2:7777', true)).toBe('ws://10.0.0.2:7777/ws')
  expect(socketUrl('https://rooms.example.com', false)).toBe('wss://rooms.example.com/ws')
})

test('a secure page explains why a plain server is out of reach', () => {
  expect(serverProblem('ws://rooms.example.com', 'https:')).toContain('secure address')
  expect(serverProblem('ws://rooms.example.com', 'http:')).toContain("Can't reach it")
  expect(serverProblem('rooms.example.com', 'https:', true)).toContain('different version')
})
