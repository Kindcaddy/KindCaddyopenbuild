// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
const { config } = require('dotenv');
const { resolve } = require('path');
const { execSync } = require('child_process');

// Load test environment variables
config({ path: resolve(__dirname, '.env.test') });

// Polyfill for Web APIs in Node.js test environment
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Run migrations on test database before tests
try {
  execSync('npx prisma migrate deploy', { 
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_URL_TEST || 'file:./test.db' },
    stdio: 'ignore' 
  });
} catch (error) {
  // If migrations fail, try db push instead
  try {
    execSync('npx prisma db push --skip-generate', { 
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_URL_TEST || 'file:./test.db' },
      stdio: 'ignore' 
    });
  } catch (pushError) {
    console.warn('Failed to setup test database schema:', pushError.message);
  }
}