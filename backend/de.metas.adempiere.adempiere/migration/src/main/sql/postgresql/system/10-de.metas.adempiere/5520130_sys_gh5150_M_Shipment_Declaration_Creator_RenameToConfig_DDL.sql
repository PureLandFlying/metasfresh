ALTER TABLE M_Shipment_Declaration_Creator RENAME TO M_Shipment_Declaration_Config;

ALTER TABLE M_Shipment_Declaration_Config RENAME COLUMN M_Shipment_Declaration_Creator_ID TO M_Shipment_Declaration_Config_ID;