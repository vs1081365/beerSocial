import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';

async function main() {
  console.log('🌱 Seeding database...');

  // Create users
  const password = await hashPassword('password123');
  
  const users = await Promise.all([
    db.user.create({
      data: {
        email: 'joao@example.com',
        name: 'João Silva',
        username: 'joaosilva',
        password,
        bio: 'Apaixonado por cervejas artesanais 🍺',
        location: 'Porto, Portugal',
        favoriteBeer: 'IPA'
      }
    }),
    db.user.create({
      data: {
        email: 'maria@example.com',
        name: 'Maria Santos',
        username: 'mariabeer',
        password,
        bio: 'Exploradora de cervejas pelo mundo',
        location: 'Lisboa, Portugal',
        favoriteBeer: 'Stout'
      }
    }),
    db.user.create({
      data: {
        email: 'pedro@example.com',
        name: 'Pedro Costa',
        username: 'pedrobeer',
        password,
        bio: 'Cervejeiro amador | Homebrewer',
        location: 'Braga, Portugal',
        favoriteBeer: 'Belgian Ale'
      }
    }),
    db.user.create({
      data: {
        email: 'ana@example.com',
        name: 'Ana Rodrigues',
        username: 'analovesbeer',
        password,
        bio: 'Sommelier de cervejas certificada',
        location: 'Coimbra, Portugal',
        favoriteBeer: 'Sour'
      }
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // Create beers
  const beers = await Promise.all([
    db.beer.create({
      data: {
        name: 'Super Bock Original',
        brewery: 'Super Bock Group',
        style: 'Lager',
        abv: 5.2,
        ibu: 18,
        country: 'Portugal',
        description: 'A cerveja portuguesa mais popular, com sabor suave e refrescante. Perfeita para dias de praia ou para acompanhar pratos de peixe grelhado.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Sagres',
        brewery: 'Sociedade Central de Cervejas',
        style: 'Lager',
        abv: 5.0,
        ibu: 15,
        country: 'Portugal',
        description: 'Cerveja tradicional portuguesa com sabor leve e equilibrado. Ideal para acompanhar petiscos e pratos mediterrânicos.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Maldita IPA',
        brewery: 'Maldita Cerveja',
        style: 'IPA',
        abv: 6.5,
        ibu: 65,
        country: 'Portugal',
        description: 'IPA portuguesa artesanal com notas cítricas e amargor pronunciado. Uma explosão de lúpulos que não vai deixar ninguém indiferente.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Mean Sourdough',
        brewery: 'Mean Sourdough Brewery',
        style: 'Sour',
        abv: 4.5,
        ibu: 8,
        country: 'Portugal',
        description: 'Sour ale refrescante com notas ácidas equilibradas. Perfeita para quem gosta de cervejas diferentes e desafiadoras.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Coral Bohemia',
        brewery: 'Cerveja Coral',
        style: 'Bock',
        abv: 5.8,
        ibu: 20,
        country: 'Portugal',
        description: 'Bock tradicional dos Açores com corpo médio e notas de malte tostado. Uma cerveja com história e caráter único.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Dois Corvos Cerveja Preta',
        brewery: 'Dois Corvos',
        style: 'Stout',
        abv: 7.0,
        ibu: 45,
        country: 'Portugal',
        description: 'Stout portuguesa artesanal com notas de café, chocolate e malte torrado. Encorpada e complexa, perfeita para noites de inverno.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Oitava Colina APA',
        brewery: 'Oitava Colina',
        style: 'Pale Ale',
        abv: 5.5,
        ibu: 40,
        country: 'Portugal',
        description: 'American Pale Ale com notas frutadas e amargor moderado. Refrescante e fácil de beber, ótima para qualquer ocasião.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Lisboa Porter',
        brewery: 'Cerveja Artesanal Lisboa',
        style: 'Porter',
        abv: 5.8,
        ibu: 35,
        country: 'Portugal',
        description: 'Porter clássica com notas de chocolate e café. Uma homenagem à cidade de Lisboa numa cerveja artesanal de qualidade.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Passarola Hoppy Alien',
        brewery: 'Passarola',
        style: 'IPA',
        abv: 6.8,
        ibu: 70,
        country: 'Portugal',
        description: 'Double IPA com muito lúpulo e notas tropicais. Uma experiência extraterrestre para os amantes de cervejas amargas.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Cervejas Alentejo Weiss',
        brewery: 'Cervejas do Alentejo',
        style: 'Wheat Beer',
        abv: 5.2,
        ibu: 12,
        country: 'Portugal',
        description: 'Weissbier tradicional com notas de banana e cravo. Refrescante e leve, perfeita para os dias quentes alentejanos.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Trindade Pilsner',
        brewery: 'Fábrica da Trindade',
        style: 'Pilsner',
        abv: 4.8,
        ibu: 22,
        country: 'Portugal',
        description: 'Pilsner clássica produzida na histórica Fábrica da Trindade em Lisboa. Fresca e com amargor equilibrado.'
      }
    }),
    db.beer.create({
      data: {
        name: 'Bohemia IPA',
        brewery: 'Cerveja Bohemia',
        style: 'IPA',
        abv: 6.2,
        ibu: 55,
        country: 'Portugal',
        description: 'IPA açoriana com notas cítricas e amargor pronunciado. Uma cerveja tropical que reflete as ilhas dos Açores.'
      }
    }),
  ]);

  console.log(`✅ Created ${beers.length} beers`);

  // Create reviews
  const reviews = await Promise.all([
    db.review.create({
      data: {
        userId: users[0].id,
        beerId: beers[0].id,
        rating: 4,
        content: 'A clássica portuguesa! Leve, refrescante e perfeita para o verão. Não é muito complexa mas faz o trabalho.'
      }
    }),
    db.review.create({
      data: {
        userId: users[1].id,
        beerId: beers[2].id,
        rating: 5,
        content: 'Incrível! Esta IPA é tudo o que procuro: amargor pronunciado, notas cítricas e um finish seco. Top das cervejas nacionais!'
      }
    }),
    db.review.create({
      data: {
        userId: users[2].id,
        beerId: beers[5].id,
        rating: 5,
        content: 'Uma stout portuguesa de excelência! Notas de café e chocolate bem presentes. Perfeita para acompanhar sobremesas.'
      }
    }),
    db.review.create({
      data: {
        userId: users[3].id,
        beerId: beers[3].id,
        rating: 4,
        content: 'Sour muito bem conseguida! Acidez equilibrada e super refrescante. Ideal para quem quer sair do convencional.'
      }
    }),
    db.review.create({
      data: {
        userId: users[0].id,
        beerId: beers[8].id,
        rating: 5,
        content: 'Esta DIPA é fantástica! Muito lúpulo, notas tropicais e um amargor que persiste. Uma das melhores nacionais!'
      }
    }),
    db.review.create({
      data: {
        userId: users[1].id,
        beerId: beers[6].id,
        rating: 4,
        content: 'Pale Ale muito agradável e fácil de beber. Boa para quem está a começar no mundo das craft beers.'
      }
    }),
    db.review.create({
      data: {
        userId: users[2].id,
        beerId: beers[4].id,
        rating: 3.5,
        content: 'Bock tradicional com personalidade. Boa para quem gosta de cervejas com mais corpo mas sem ser muito pesada.'
      }
    }),
    db.review.create({
      data: {
        userId: users[3].id,
        beerId: beers[9].id,
        rating: 4.5,
        content: 'Weiss muito bem feita! As notas de banana e cravo estão presentes e a refrescância é ideal para o verão português.'
      }
    }),
    db.review.create({
      data: {
        userId: users[0].id,
        beerId: beers[7].id,
        rating: 4,
        content: 'Porter lisboeta com muita classe! Notas de chocolate e café, perfeita para uma noite no Chiado.'
      }
    }),
    db.review.create({
      data: {
        userId: users[1].id,
        beerId: beers[1].id,
        rating: 3,
        content: 'A clássica Sagres. Simples mas eficaz. Ideal para acompanhar um bom petisco.'
      }
    }),
  ]);

  console.log(`✅ Created ${reviews.length} reviews`);

  // Create some likes
  await Promise.all([
    db.like.create({ data: { userId: users[1].id, reviewId: reviews[0].id } }),
    db.like.create({ data: { userId: users[2].id, reviewId: reviews[0].id } }),
    db.like.create({ data: { userId: users[0].id, reviewId: reviews[1].id } }),
    db.like.create({ data: { userId: users[3].id, reviewId: reviews[1].id } }),
    db.like.create({ data: { userId: users[0].id, reviewId: reviews[2].id } }),
    db.like.create({ data: { userId: users[1].id, reviewId: reviews[4].id } }),
    db.like.create({ data: { userId: users[2].id, reviewId: reviews[4].id } }),
  ]);

  console.log('✅ Created likes');

  // Create friendships
  await Promise.all([
    db.friendship.create({ 
      data: { 
        requesterId: users[0].id, 
        addresseeId: users[1].id,
        status: 'ACCEPTED'
      } 
    }),
    db.friendship.create({ 
      data: { 
        requesterId: users[0].id, 
        addresseeId: users[2].id,
        status: 'ACCEPTED'
      } 
    }),
    db.friendship.create({ 
      data: { 
        requesterId: users[1].id, 
        addresseeId: users[3].id,
        status: 'ACCEPTED'
      } 
    }),
    db.friendship.create({ 
      data: { 
        requesterId: users[2].id, 
        addresseeId: users[3].id,
        status: 'PENDING'
      } 
    }),
  ]);

  console.log('✅ Created friendships');

  // Create some comments
  await Promise.all([
    db.comment.create({
      data: {
        userId: users[1].id,
        reviewId: reviews[0].id,
        content: 'Concordo totalmente! É a minha favorita para o verão.'
      }
    }),
    db.comment.create({
      data: {
        userId: users[0].id,
        reviewId: reviews[1].id,
        content: 'Também adoro! Vou experimentar mais dessa cervejeira.'
      }
    }),
    db.comment.create({
      data: {
        userId: users[3].id,
        reviewId: reviews[4].id,
        content: 'Essa é espetacular! O amargor é incrível!'
      }
    }),
  ]);

  console.log('✅ Created comments');

  console.log('🎉 Seed completed!');
  console.log('\n📝 Test accounts (password: password123):');
  users.forEach(user => {
    console.log(`   - ${user.email} (@${user.username})`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
