// test-cosmos-v3.js - Script de Testing para Cosmos DB v3

import CosmosServiceV3 from './services/cosmosService_v3.js';
import AuthServiceV3 from './services/authService_v3.js';

const cosmosService = new CosmosServiceV3();
const authService = new AuthServiceV3(cosmosService);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAll() {
  console.log('🧪 ===== INICIANDO TESTS COSMOS DB V3 =====\n');

  const testUser = 'test_91004';
  const testUserInfo = {
    usuario: 'test_91004',
    nombre: 'Juan Test',
    paterno: 'Pérez',
    materno: 'García',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token'
  };

  let passed = 0;
  let failed = 0;

  try {
    // ========================================
    // TEST 1: Stats iniciales
    // ========================================
    console.log('1️⃣  TEST: Stats del servicio');
    const stats = await authService.getStats();
    console.log('   📊 Cosmos disponible:', stats.cosmosAvailable);
    console.log('   📊 Versión:', stats.authVersion);
    console.log('   📊 TTL sesión:', stats.sessionTTL);
    if (stats.cosmosAvailable) {
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Cosmos no disponible\n');
      failed++;
      return;
    }

    await sleep(500);

    // ========================================
    // TEST 2: Crear sesión
    // ========================================
    console.log('2️⃣  TEST: Crear sesión de usuario');
    const created = await authService.setUserAuthenticated(testUser, testUserInfo);
    if (created) {
      console.log('   ✅ PASS - Sesión creada\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - No se pudo crear sesión\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 3: Verificar autenticación
    // ========================================
    console.log('3️⃣  TEST: Verificar autenticación');
    const isAuth = await authService.isUserAuthenticated(testUser);
    if (isAuth) {
      console.log('   ✅ PASS - Usuario autenticado\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Usuario NO autenticado\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 4: Obtener información de usuario
    // ========================================
    console.log('4️⃣  TEST: Obtener información de usuario');
    const userInfo = await authService.getUserInfo(testUser);
    if (userInfo && userInfo.nombre === testUserInfo.nombre) {
      console.log('   📝 Nombre:', userInfo.nombre);
      console.log('   📝 Usuario:', userInfo.usuario);
      console.log('   📝 Token:', userInfo.token.substring(0, 20) + '...');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Info no coincide\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 5: Obtener token
    // ========================================
    console.log('5️⃣  TEST: Obtener token del usuario');
    const token = await authService.getUserToken(testUser);
    if (token && token === testUserInfo.token) {
      console.log('   🔑 Token:', token.substring(0, 30) + '...');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Token incorrecto\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 6: Guardar mensajes
    // ========================================
    console.log('6️⃣  TEST: Guardar mensajes');
    const messages = [
      { role: 'user', content: '¿Cuál es mi saldo?' },
      { role: 'assistant', content: 'Tu saldo actual es $10,000 MXN' },
      { role: 'user', content: '¿Y las tasas de interés?' },
      { role: 'assistant', content: 'Las tasas actuales son: CETES 28 días: 11.25%' },
      { role: 'user', content: 'Gracias por la información' },
      { role: 'assistant', content: '¡De nada! ¿Hay algo más en lo que pueda ayudarte?' }
    ];

    let savedCount = 0;
    for (const msg of messages) {
      const saved = await cosmosService.saveMessage(testUser, msg.role, msg.content);
      if (saved) savedCount++;
    }

    if (savedCount === messages.length) {
      console.log(`   💾 Guardados ${savedCount}/${messages.length} mensajes`);
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log(`   ❌ FAIL - Solo ${savedCount}/${messages.length} guardados\n`);
      failed++;
    }

    await sleep(1000);

    // ========================================
    // TEST 7: Obtener últimos mensajes
    // ========================================
    console.log('7️⃣  TEST: Obtener últimos mensajes');
    const retrievedMessages = await cosmosService.getLastMessages(testUser, 10);
    if (retrievedMessages.length > 0) {
      console.log(`   📚 Total mensajes: ${retrievedMessages.length}`);
      retrievedMessages.forEach((m, i) => {
        const preview = m.content.substring(0, 40);
        console.log(`   ${i + 1}. [${m.role}] ${preview}...`);
      });
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - No se obtuvieron mensajes\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 8: Obtener mensajes por rol
    // ========================================
    console.log('8️⃣  TEST: Obtener mensajes por rol');
    const { userMessages, assistantMessages } = await cosmosService.getLastMessagesByRole(testUser);
    console.log(`   👤 Mensajes usuario: ${userMessages.length}`);
    console.log(`   🤖 Mensajes asistente: ${assistantMessages.length}`);
    if (userMessages.length > 0 && assistantMessages.length > 0) {
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Mensajes por rol incorrectos\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 9: Renovar TTL
    // ========================================
    console.log('9️⃣  TEST: Renovar TTL de sesión');
    const renewed = await cosmosService.renewUserTTL(testUser);
    if (renewed) {
      console.log('   🔄 TTL renovado a 60min');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - No se pudo renovar TTL\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 10: Obtener datos completos
    // ========================================
    console.log('🔟 TEST: Obtener datos completos del usuario');
    const userData = await cosmosService.getUserData(testUser);
    if (userData.session && userData.messages.length > 0) {
      console.log(`   👤 Sesión: ${userData.session.nombre}`);
      console.log(`   💬 Mensajes: ${userData.messages.length}`);
      console.log(`   ⏰ Login: ${userData.session.loginAt}`);
      console.log(`   🕐 Última actividad: ${userData.session.lastActivity}`);
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Datos incompletos\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 11: Limpiar mensajes
    // ========================================
    console.log('1️⃣1️⃣ TEST: Limpiar mensajes del usuario');
    const deletedMessages = await cosmosService.clearUserMessages(testUser);
    console.log(`   🗑️  Mensajes eliminados: ${deletedMessages}`);
    if (deletedMessages > 0) {
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - No se eliminaron mensajes\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 12: Verificar mensajes eliminados
    // ========================================
    console.log('1️⃣2️⃣ TEST: Verificar que mensajes fueron eliminados');
    const afterClear = await cosmosService.getLastMessages(testUser, 10);
    if (afterClear.length === 0) {
      console.log('   📭 No hay mensajes (correcto)');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log(`   ❌ FAIL - Aún hay ${afterClear.length} mensajes\n`);
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 13: Logout
    // ========================================
    console.log('1️⃣3️⃣ TEST: Cerrar sesión (logout)');
    const loggedOut = await authService.clearUserAuthentication(testUser);
    if (loggedOut) {
      console.log('   🚪 Sesión cerrada');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - No se pudo cerrar sesión\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 14: Verificar logout
    // ========================================
    console.log('1️⃣4️⃣ TEST: Verificar que sesión fue cerrada');
    const isAuthAfter = await authService.isUserAuthenticated(testUser);
    if (!isAuthAfter) {
      console.log('   🔒 Usuario NO autenticado (correcto)');
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Usuario aún autenticado\n');
      failed++;
    }

    await sleep(500);

    // ========================================
    // TEST 15: Comando logout
    // ========================================
    console.log('1️⃣5️⃣ TEST: Detectar comando de logout');
    const commands = ['logout', 'cerrar sesion', 'salir', 'LOGOUT'];
    let allDetected = true;
    commands.forEach(cmd => {
      const detected = authService.isLogoutCommand(cmd);
      console.log(`   "${cmd}" → ${detected ? '✅' : '❌'}`);
      if (!detected) allDetected = false;
    });

    if (allDetected) {
      console.log('   ✅ PASS\n');
      passed++;
    } else {
      console.log('   ❌ FAIL - Algunos comandos no detectados\n');
      failed++;
    }

  } catch (error) {
    console.error('\n❌ ERROR CRÍTICO EN TESTS:', error);
    console.error('Stack:', error.stack);
    failed++;
  }

  // ========================================
  // RESUMEN
  // ========================================
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESUMEN DE TESTS');
  console.log('='.repeat(50));
  console.log(`✅ Tests exitosos: ${passed}`);
  console.log(`❌ Tests fallidos: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  console.log(`📈 Tasa de éxito: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 ¡TODOS LOS TESTS PASARON!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  ALGUNOS TESTS FALLARON - Revisar errores arriba\n');
    process.exit(1);
  }
}

// Ejecutar tests
testAll().catch(error => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});
