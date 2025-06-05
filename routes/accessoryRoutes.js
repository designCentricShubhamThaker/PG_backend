import express from 'express';
import {
  getAllAccessories,

  createAccessory,
  updateAccessory,
  deleteAccessory
} from '../controllers/AccessoryController.js';

const router = express.Router();

router.route('/')
  .get(getAllAccessories)
  .post(createAccessory);

router.route('/:id')

  .put(updateAccessory)
  .delete(deleteAccessory);

export default router;
