import express from 'express';
import orderRoutes from './orderRoutes.js';
import glassRoutes from './glassRoutes.js';
import capRoutes from './capRoutes.js';
import boxRoutes from './boxRoutes.js';
import pumpRoutes from './pumpRoutes.js'; 
import authRoutes from './authRoutes.js'; 
import accessoryRoutes from './accessoryRoutes.js'; 
import bottleDataRoutes from './bottleDataRoutes.js'; 
import pumpDataRoutes from './pumpDataRoutes.js'; 
import capDataRoutes from './capDataRoutes.js'; 
import boxDataRoutes from './boxDataRoutes.js'; 
import customerRoutes from './customerRoutes.js'; 
import TeamOrderRoutes from './TeamOrderRoutes.js'; 
import printingRoutes from './printingRoutes.js'; 
import foilingRoutes from './foilingRoutes.js'; 
import coatingRoutes from './coatingRoutes.js'; 
import frostingRoutes from './frostingRoutes.js'; 

const router = express.Router();

router.use('/orders', orderRoutes);
router.use('/team-orders', TeamOrderRoutes);
router.use('/glass', glassRoutes);
router.use('/caps', capRoutes);
router.use('/boxes', boxRoutes);
router.use('/pumps', pumpRoutes);
router.use('/auth', authRoutes);
router.use('/accessories', accessoryRoutes)
router.use('/bottledata', bottleDataRoutes)
router.use('/pumpdata', pumpDataRoutes)
router.use('/capdata', capDataRoutes)
router.use('/boxdata', boxDataRoutes)
router.use('/customer', customerRoutes)
router.use('/print', printingRoutes)
router.use('/coat', coatingRoutes)
router.use('/frost', frostingRoutes)
router.use('/foil', foilingRoutes)


export default router;