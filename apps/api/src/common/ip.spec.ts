import { truncateIp } from './ip.js';

describe('truncateIp', () => {
  it('kürzt IPv4 auf /24', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0');
  });
  it('behandelt IPv4-mapped IPv6', () => {
    expect(truncateIp('::ffff:198.51.100.7')).toBe('198.51.100.0');
  });
  it('kürzt IPv6 auf /48', () => {
    expect(truncateIp('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd::');
  });
  it('liefert null bei fehlender oder ungültiger IP', () => {
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('kein-ip')).toBeNull();
  });
});
