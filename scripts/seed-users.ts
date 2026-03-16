// Seed script to create test users
// Run with: npx tsx scripts/seed-users.ts

import { getMongoDB } from '../src/lib/mongodb-client';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'beersocial_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function seedUsers() {
  console.log('Seeding test users...');

  const mongo = await getMongoDB();

  const users = [
    { email: 'user1@example.com', password: 'password123', name: 'João Silva', username: 'joao' },
    { email: 'user2@example.com', password: 'password123', name: 'Maria Santos', username: 'maria' },
    { email: 'user3@example.com', password: 'password123', name: 'Pedro Costa', username: 'pedro' },
  ];

  for (const user of users) {
    try {
      const hashedPassword = await hashPassword(user.password);

      const result = await mongo.db.collection('user_profiles').insertOne({
        _id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: user.email,
        password: hashedPassword,
        name: user.name,
        username: user.username,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`✅ Created user: ${user.name} (${user.username}) - ID: ${result.insertedId}`);
    } catch (error) {
      console.error(`Error creating ${user.name}:`, error);
    }
  }

  console.log('Seeding complete!');
}

seedUsers().catch(console.error);