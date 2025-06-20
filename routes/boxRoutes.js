import express from 'express';
import {
getBoxOrders,
updateBoxTracking
} from '../controllers/boxController.js';

const router = express.Router();

router.route('/')
  .get(getBoxOrders)
  .patch(updateBoxTracking)



export default router;